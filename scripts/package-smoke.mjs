import assert from "node:assert";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
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
const consumerRoot = join(temporaryRoot, "consumer");

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
  writeFileSync(
    join(consumerRoot, "changes.json"),
    JSON.stringify({
      api: "localhost",
      changes: [
        {
          endpoint: "GET /charge",
          factor: 100,
          field: "amount",
          kind: "unit-change",
        },
      ],
    }),
  );
  writeFileSync(
    join(consumerRoot, "weak.test.mjs"),
    `import assert from "node:assert/strict";
import test from "node:test";

globalThis.fetch = async () =>
  new Response(JSON.stringify({ amount: 1000, currency: "usd" }), {
    headers: { "content-type": "application/json" },
  });

test("fetches a JSON response", async () => {
  const response = await globalThis.fetch("http://localhost/charge");
  assert.ok(await response.json());
});
`,
  );

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

  const scan = await run(
    "npx",
    ["--no-install", "migrateproof", "--changes", "changes.json"],
    consumerRoot,
  );
  const scanOutput = `${scan.stdout}\n${scan.stderr}`;
  assert.equal(scan.exitCode, 1, `expected exit 1:\n${scanOutput}`);
  assert.match(scanOutput, /Missed/, "expected a missed-coverage result");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
