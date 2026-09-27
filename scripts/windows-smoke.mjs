import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { resolveNpmCommand } from "../dist/process/npmCommand.js";
import { runScanFix } from "../dist/patch/runScanFix.js";
import {
  BackendShutdownError,
  runBackendProcess,
} from "../dist/patch/backends/runBackendProcess.js";

if (process.platform !== "win32" && process.argv[2] !== "--allow-non-windows") {
  console.error(
    "Native Windows required. --allow-non-windows checks the harness only.",
  );
  process.exit(2);
}
const execFileAsync = promisify(execFile);
const root = mkdtempSync(join(tmpdir(), "mp windows smoke "));
const [npmCommand, ...npmArgs] = resolveNpmCommand(["--version"]);
await execFileAsync(npmCommand, npmArgs, { cwd: root, timeout: 10_000 });

const literalArgs = [
  "space in value",
  "& echo unexpected",
  "%PATH%",
  "^caret",
  "(parentheses)",
];
const literal = await runBackendProcess({
  label: "node",
  command: process.execPath,
  args: [
    "-e",
    "console.log(JSON.stringify(process.argv.slice(1)))",
    "--",
    ...literalArgs,
  ],
  cwd: root,
  timeoutMs: 10_000,
});
assert.deepEqual(JSON.parse(literal.stdout), literalArgs);

const pidPath = join(root, "child.pid");
const childScript = [
  "const { spawn } = require('node:child_process');",
  "const { writeFileSync } = require('node:fs');",
  "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setTimeout(() => {}, 30000)\"], { stdio: 'ignore' });",
  `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
  "setTimeout(() => {}, 30000);",
].join("\n");
try {
  await assert.rejects(
    runBackendProcess({
      label: "node",
      command: process.execPath,
      args: ["-e", childScript],
      cwd: root,
      timeoutMs: 1500,
    }),
    BackendShutdownError,
  );
  const childPid = Number(readFileSync(pidPath, "utf8"));
  let exited = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(childPid, 0);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      exited = true;
      break;
    }
    await delay(100);
  }
  assert.ok(exited, "owned descendant survived process-tree timeout");
} finally {
  if (existsSync(pidPath)) {
    try {
      process.kill(Number(readFileSync(pidPath, "utf8")), "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

const project = join(root, "consumer with spaces");
mkdirSync(join(project, "test", "contracts"), { recursive: true });
mkdirSync(join(project, "config"));
const source = `export async function amount() { return (await (await fetch("https://api.example.com/order")).json()).legacy; }\n`;
writeFileSync(join(project, ".gitignore"), "node_modules/\n");
writeFileSync(
  join(project, "package.json"),
  JSON.stringify({
    name: "native-windows-smoke",
    private: true,
    type: "module",
    scripts: { test: "node --test" },
  }),
);
writeFileSync(join(project, "consumer.mjs"), source);
writeFileSync(
  join(project, "config", "changes.json"),
  JSON.stringify({
    api: "api.example.com",
    changes: [{ endpoint: "GET /order", field: "legacy", kind: "removed" }],
  }),
);
writeFileSync(
  join(project, "test", "contracts", "order.test.mjs"),
  `import assert from "node:assert/strict";
import test from "node:test";
import { amount } from "../../consumer.mjs";
globalThis.fetch = async () => new Response(JSON.stringify({ legacy: 42, total: 42 }));
test("keeps the order amount", async () => assert.equal(await amount(), 42));\n`,
);
for (const args of [
  ["init"],
  ["add", "."],
  [
    "-c",
    "user.name=Smoke",
    "-c",
    "user.email=smoke@example.invalid",
    "commit",
    "-m",
    "synthetic Windows consumer",
  ],
])
  await execFileAsync("git", args, { cwd: project, timeout: 30_000 });
const repairRoot =
  process.platform === "win32" ? project.toUpperCase() : project;
const gitRoot = realpathSync(
  (
    await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: repairRoot,
    })
  ).stdout.trim(),
);
const rootSpellingDiffers = realpathSync(repairRoot) !== gitRoot;
console.log(
  JSON.stringify({ check: "git-root-spelling", rootSpellingDiffers }),
);
const result = await runScanFix(repairRoot, "config/changes.json", {
  async run(input) {
    writeFileSync(
      join(input.worktreeDir, "consumer.mjs"),
      source.replace(".legacy", ".total"),
    );
    return { appliedFiles: [], rawLog: "" };
  },
});
try {
  assert.equal(result.status, "compatible-candidate");
  assert.equal(result.before.status, "caught");
  assert.equal(result.after.status, "missed");
  assert.equal(readFileSync(join(project, "consumer.mjs"), "utf8"), source);
  assert.equal(
    (await execFileAsync("git", ["status", "--porcelain"], { cwd: project }))
      .stdout,
    "",
  );
  console.log(
    JSON.stringify({
      platform: process.platform,
      nativeWindows: process.platform === "win32",
      rootSpellingDiffers,
      node: process.version,
      checks: [
        "npm-entry",
        "literal-argv",
        "process-tree",
        "nested-path-repair",
      ],
      scanFixSha256: createHash("sha256")
        .update(
          readFileSync(new URL("../dist/patch/runScanFix.js", import.meta.url)),
        )
        .digest("hex"),
      passed: true,
    }),
  );
} finally {
  await execFileAsync(
    "git",
    ["worktree", "remove", "--force", result.worktreeDir],
    { cwd: project },
  );
  rmSync(root, { recursive: true, force: true });
}
