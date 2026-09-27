import assert from "node:assert";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

function run(command, args, cwd, env = process.env) {
  if (command === "npm" && process.platform === "win32") {
    const npmPath = process.env.npm_execpath;
    assert.ok(
      npmPath &&
        isAbsolute(npmPath) &&
        /[/\\]npm-cli\.js$/i.test(npmPath) &&
        existsSync(npmPath),
      "Run this smoke through npm run package:smoke on Windows",
    );
    command = process.execPath;
    args = [npmPath, ...args];
  }
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        exitCode: typeof error?.code === "number" ? error.code : 0,
        stderr,
        stdout,
      });
    });
  });
}

const temporaryRoot = mkdtempSync(
  join(tmpdir(), "migrateproof-package-smoke-"),
);
const consumerRoot = join(temporaryRoot, "consumer with spaces");

try {
  const packed = await run(
    "npm",
    ["pack", "--json", "--pack-destination", temporaryRoot],
    process.cwd(),
  );
  assert.equal(packed.exitCode, 0, `npm pack failed:\n${packed.stderr}`);

  const packManifest = JSON.parse(packed.stdout);
  const tarballName = Array.isArray(packManifest)
    ? packManifest[0]?.filename
    : undefined;
  assert.equal(
    typeof tarballName,
    "string",
    "npm pack returned no tarball filename",
  );
  const tarballPath = join(temporaryRoot, tarballName);
  assert.ok(existsSync(tarballPath), `npm pack did not create ${tarballName}`);

  mkdirSync(consumerRoot);
  writeFileSync(
    join(consumerRoot, "package.json"),
    JSON.stringify({
      name: "migrateproof-smoke-consumer",
      private: true,
      scripts: { test: "node --test" },
      type: "module",
    }),
  );
  const changes = {
    api: "localhost",
    changes: [
      {
        endpoint: "GET /charge",
        factor: 100,
        field: "amount",
        kind: "unit-change",
      },
    ],
  };
  const changesPath = join(consumerRoot, "changes.json");
  const testPath = join(consumerRoot, "consumer.test.mjs");
  writeFileSync(changesPath, JSON.stringify(changes));
  const consumerTest = `import assert from "node:assert/strict";
import test from "node:test";

globalThis.fetch = async () =>
  new Response(JSON.stringify({ amount: 1000, currency: "usd" }), {
    headers: { "content-type": "application/json" },
  });

test("fetches a JSON response", async () => {
  const response = await globalThis.fetch("http://localhost/charge");
  assert.ok(await response.json());
});
`;
  writeFileSync(testPath, consumerTest);

  const installed = await run(
    "npm",
    ["install", "--ignore-scripts", tarballPath],
    consumerRoot,
  );
  assert.equal(
    installed.exitCode,
    0,
    `npm install failed:\n${installed.stderr}`,
  );
  assert.ok(
    existsSync(join(consumerRoot, "node_modules", ".bin", "migrateproof")),
    "installed migrateproof binary is absent",
  );

  const installedCli = join(
    consumerRoot,
    "node_modules",
    "migrateproof",
    "dist",
    "cli",
    "index.js",
  );
  const scanArgs = [installedCli, "--changes", "changes.json", "--json"];
  const scan = await run(process.execPath, scanArgs, consumerRoot);
  const scanOutput = `${scan.stdout}\n${scan.stderr}`;
  assert.equal(scan.exitCode, 1, `expected exit 1:\n${scanOutput}`);
  const missedReport = JSON.parse(scan.stdout);
  assert.equal(missedReport.verdict, "gaps");
  assert.deepEqual(
    missedReport.outcomes.map((outcome) => outcome.status),
    ["missed"],
  );

  writeFileSync(
    testPath,
    consumerTest.replace(
      "assert.ok(await response.json());",
      "assert.equal((await response.json()).amount, 1000);",
    ),
  );
  const caught = await run(process.execPath, scanArgs, consumerRoot);
  assert.equal(caught.exitCode, 0, `expected exit 0:\n${caught.stderr}`);
  const caughtReport = JSON.parse(caught.stdout);
  assert.equal(caughtReport.verdict, "protected");
  assert.deepEqual(
    caughtReport.outcomes.map((outcome) => outcome.status),
    ["caught"],
  );

  changes.changes[0].field = "missing";
  writeFileSync(changesPath, JSON.stringify(changes));
  const incomplete = await run(process.execPath, scanArgs, consumerRoot);
  assert.equal(
    incomplete.exitCode,
    2,
    `expected exit 2:\n${incomplete.stderr}`,
  );
  const incompleteReport = JSON.parse(incomplete.stdout);
  assert.equal(incompleteReport.verdict, "incomplete");
  assert.deepEqual(
    incompleteReport.outcomes.map((outcome) => outcome.status),
    ["incomplete"],
  );

  changes.changes[0].field = "amount";
  writeFileSync(changesPath, JSON.stringify(changes));
  writeFileSync(join(consumerRoot, ".gitignore"), "node_modules/\n");
  const sourcePath = join(consumerRoot, "consumer.mjs");
  const source = `export async function amount() {
  const body = await (await fetch("http://localhost/charge")).json();
  return body.amount;
}
`;
  writeFileSync(sourcePath, source);
  writeFileSync(
    testPath,
    `import assert from "node:assert/strict";
import test from "node:test";
import { amount } from "./consumer.mjs";
globalThis.fetch = async () => new Response(JSON.stringify({ amount: 1000, subtotal: 900, tax: 100 }));
test("keeps the total", async () => { assert.equal(await amount(), 1000); });
`,
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
      "temporary consumer",
    ],
  ]) {
    const gitResult = await run("git", args, consumerRoot);
    assert.equal(gitResult.exitCode, 0, gitResult.stderr);
  }
  const backendPath = join(temporaryRoot, "stub-backend.mjs");
  const backendModule = pathToFileURL(
    join(
      consumerRoot,
      "node_modules",
      "migrateproof",
      "dist",
      "cli",
      "patch.js",
    ),
  ).href;
  const fixArgs = [
    "--import",
    pathToFileURL(backendPath).href,
    installedCli,
    "scan",
    "--changes",
    "changes.json",
    "--fix",
    "--patch-backend",
    "codex",
    "--json",
  ];
  for (const repair of [true, false]) {
    const candidateSource = source.replace(
      "body.amount",
      "body.subtotal + body.tax",
    );
    writeFileSync(
      backendPath,
      `import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKEND_FACTORIES } from ${JSON.stringify(backendModule)};
BACKEND_FACTORIES.codex = () => ({ async run(input) {
  writeFileSync(join(input.worktreeDir, ${JSON.stringify(repair ? "consumer.mjs" : "consumer.test.mjs")}), ${JSON.stringify(repair ? candidateSource : "export {};\n")});
  return { appliedFiles: [], rawLog: "PRIVATE_BACKEND_LOG_SENTINEL" };
}});
`,
    );
    const fix = await run(process.execPath, fixArgs, consumerRoot);
    assert.equal(fix.exitCode, repair ? 0 : 1, `${fix.stdout}\n${fix.stderr}`);
    assert.ok(
      !`${fix.stdout}\n${fix.stderr}`.includes("PRIVATE_BACKEND_LOG_SENTINEL"),
    );
    const result = JSON.parse(fix.stdout);
    assert.equal(result.kind, "scan-fix");
    assert.equal(result.status, repair ? "compatible-candidate" : "rejected");
    try {
      assert.equal(readFileSync(sourcePath, "utf8"), source);
      if (repair) {
        assert.equal(result.before.status, "caught");
        assert.equal(result.after.status, "missed");
        assert.deepEqual(result.changedFiles, ["consumer.mjs"]);
      }
      const clean = await run("git", ["status", "--porcelain"], consumerRoot);
      assert.equal(clean.stdout, "");
    } finally {
      const removed = await run(
        "git",
        ["worktree", "remove", "--force", result.worktreeDir],
        consumerRoot,
      );
      assert.equal(removed.exitCode, 0, removed.stderr);
    }
  }
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
