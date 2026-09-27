import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CodexPatchBackend } from "../dist/patch/backends/codex.js";
import { runScanFix } from "../dist/patch/runScanFix.js";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 5 * 60 * 1000;
const mode = process.argv[2];
if (process.argv.length !== 3 || !["--live", "--dry-run"].includes(mode)) {
  console.error(
    "Usage: node scripts/live-backend-smoke.mjs --dry-run | --live (up to 3 paid Codex calls; synthetic repositories retained)",
  );
  process.exit(2);
}

const scenarios = [
  {
    name: "removed-legacy-field",
    body: { legacyAmount: 1200, amount: 1200 },
    expected: 1200,
    change: { field: "legacyAmount", kind: "removed" },
    contract:
      "Return the order amount. amount replaces legacyAmount; use legacyAmount only for old envelopes without amount.",
    expression: "body.legacyAmount",
    repair: "body.amount ?? body.legacyAmount",
    holdouts: [
      [{ amount: 721 }, 721],
      [{ legacyAmount: 49 }, 49],
      [{ legacyAmount: 0, amount: 0 }, 0],
    ],
  },
  {
    name: "unit-change",
    body: { amount: 12, minorAmount: 1200 },
    expected: 1200,
    change: { field: "amount", kind: "unit-change", factor: 100 },
    contract:
      "Return minor currency units. minorAmount is canonical when present. Only old envelopes without minorAmount use amount in major units; multiply that legacy amount by 100.",
    expression: "body.amount * 100",
    repair: "body.minorAmount ?? body.amount * 100",
    holdouts: [
      [{ amount: 2, minorAmount: 200 }, 200],
      [{ amount: 200, minorAmount: 200 }, 200],
      [{ amount: 3 }, 300],
      [{ amount: 0, minorAmount: 0 }, 0],
    ],
  },
  {
    name: "nullable-nested-profile",
    body: { profile: { name: "Ada" }, displayName: "Ada" },
    expected: "Ada",
    change: { field: "profile", kind: "now-nullable" },
    contract:
      "Return profile.name when profile exists; otherwise use displayName. Profiles may be null. Preserve an empty profile name rather than treating it as absent.",
    expression: "body.profile.name",
    repair: "body.profile?.name ?? body.displayName",
    holdouts: [
      [{ profile: null, displayName: "Grace" }, "Grace"],
      [{ profile: { name: "Lin" }, displayName: "fallback" }, "Lin"],
      [{ profile: { name: "" }, displayName: "fallback" }, ""],
    ],
  },
];

function source(expression) {
  return `export async function value() {
  const body = await (await fetch("https://api.example.com/order")).json();
  return ${expression};
}
`;
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function git(root, args) {
  return execFileAsync("git", args, { cwd: root, timeout: 30_000 });
}

async function checkHoldouts(worktree, scenario) {
  const moduleUrl = pathToFileURL(join(worktree, "consumer.mjs")).href;
  const code = `import assert from "node:assert/strict";
const { value } = await import(${JSON.stringify(moduleUrl)});
for (const [body, expected] of ${JSON.stringify(scenario.holdouts)}) {
  globalThis.fetch = async () => new Response(JSON.stringify(body));
  assert.equal(await value(), expected);
}`;
  try {
    await execFileAsync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: worktree,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

process.env.MIGRATEPROOF_BACKEND_TIMEOUT_MS = String(TIMEOUT_MS);
const root = mkdtempSync(join(tmpdir(), "migrateproof-live-eval-"));
const results = [];
let invocations = 0;
let backendUnavailable = false;
for (const scenario of scenarios) {
  if (backendUnavailable) {
    results.push({
      scenario: scenario.name,
      status: "not-run",
      reason: "previous backend invocation failed; no repeated paid retries",
    });
    continue;
  }
  const project = join(root, scenario.name);
  mkdirSync(project);
  const files = {
    ".gitignore": "node_modules/\n",
    "package.json": JSON.stringify({
      name: "synthetic-repair-evaluation",
      private: true,
      type: "module",
      scripts: { test: "node --test" },
    }),
    "README.md": `${scenario.contract}\n`,
    "consumer.mjs": source(scenario.expression),
    "consumer.test.mjs": `import assert from "node:assert/strict";
import test from "node:test";
import { value } from "./consumer.mjs";
globalThis.fetch = async () => new Response(JSON.stringify(${JSON.stringify(scenario.body)}));
test("preserves the documented contract", async () => assert.equal(await value(), ${JSON.stringify(scenario.expected)}));
`,
    "changes.json": JSON.stringify({
      api: "api.example.com",
      changes: [
        { endpoint: "GET /order", ...scenario.change, note: scenario.contract },
      ],
    }),
  };
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(project, name), content);
  for (const args of [
    ["init"],
    ["add", "."],
    [
      "-c",
      "user.name=Evaluation",
      "-c",
      "user.email=evaluation@example.invalid",
      "commit",
      "-m",
      "synthetic baseline",
    ],
  ])
    await git(project, args);
  const originalHashes = Object.fromEntries(
    Object.keys(files).map((name) => [name, hash(join(project, name))]),
  );
  let backendError = null;
  const backend = {
    async run(input) {
      if (mode === "--dry-run") {
        writeFileSync(
          join(input.worktreeDir, "consumer.mjs"),
          source(scenario.repair),
        );
        return { appliedFiles: ["consumer.mjs"], rawLog: "" };
      }
      assert.ok(invocations < 3);
      invocations += 1;
      try {
        return await new CodexPatchBackend().run(input);
      } catch {
        backendError = "backend invocation failed; raw logs withheld";
        backendUnavailable = true;
        throw new Error(backendError);
      }
    },
  };
  const started = Date.now();
  try {
    const report = await runScanFix(project, "changes.json", backend);
    const unchanged = Object.entries(originalHashes).every(
      ([name, digest]) => hash(join(project, name)) === digest,
    );
    const protectedNames = Object.keys(files).filter(
      (name) => name !== "consumer.mjs",
    );
    const oracleIntact = protectedNames.every(
      (name) => hash(join(report.worktreeDir, name)) === originalHashes[name],
    );
    const holdoutsPassed =
      report.status === "compatible-candidate" &&
      (await checkHoldouts(report.worktreeDir, scenario));
    const result = {
      scenario: scenario.name,
      status: report.status,
      before: report.before.status,
      after: report.after?.status ?? null,
      originalUnchanged: unchanged,
      oracleIntact,
      holdoutsPassed,
      changedFiles: report.changedFiles,
      worktreeDir: report.worktreeDir,
      elapsedMs: Date.now() - started,
      backendError,
      reason: report.reason,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } catch {
    const result = {
      scenario: scenario.name,
      status: "evaluation-error",
      elapsedMs: Date.now() - started,
      backendError,
      reason:
        "preflight or verification could not complete; no success claimed",
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  writeFileSync(
    join(root, "results.json"),
    JSON.stringify({ mode, invocations, results }, null, 2),
  );
}
const passed =
  results.length === scenarios.length &&
  results.every(
    (result) =>
      result.status === "compatible-candidate" &&
      result.originalUnchanged &&
      result.oracleIntact &&
      result.holdoutsPassed,
  );
writeFileSync(
  join(root, "results.json"),
  JSON.stringify({ mode, invocations, results, passed }, null, 2),
);
console.log(
  JSON.stringify({
    mode,
    invocations,
    passed,
    evidence: join(root, "results.json"),
    retainedRoot: root,
  }),
);
process.exitCode = passed ? 0 : 1;
