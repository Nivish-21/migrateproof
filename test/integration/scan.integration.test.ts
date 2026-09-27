// test/integration/scan.integration.test.ts
import { execFile } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runMutations } from "../../src/mutation/runMutations.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

describe("scan integration", () => {
  it("reports gaps for a deliberately weak test suite", async () => {
    const report = await runMutations(resolve("test/integration/weak-project"));
    expect(report.verdict).toBe("gaps");
    const taxGaps = report.outcomes.filter(
      (o) => o.mutation?.fieldPath === "tax" && o.status === "missed",
    );
    expect(taxGaps.length).toBeGreaterThan(0);
  }, 120_000);

  it("reports no tax gaps for a deliberately strong test suite", async () => {
    const report = await runMutations(
      resolve("test/integration/strong-project"),
    );
    const taxGaps = report.outcomes.filter(
      (o) => o.mutation?.fieldPath === "tax" && o.status === "missed",
    );
    expect(taxGaps).toEqual([]);
  }, 120_000);
});

describe("ephemeral-port projects", () => {
  // Regression guard. A project that binds a fresh random port per test used
  // to produce a new endpoint identity on every run, so nothing could be
  // intercepted at re-run time and the report named ports that no longer
  // existed. observe() now strips the port from loopback URLs.
  it("recognises one endpoint despite a new random port each run, and finds its gaps", async () => {
    const report = await runMutations(
      resolve("test/integration/ephemeral-port-project"),
    );

    expect(report.verdict).toBe("gaps");

    // One logical endpoint, not one per port.
    const endpoints = new Set(report.outcomes.map((o) => o.endpoint));
    expect(endpoints.size).toBe(1);

    // The surviving identity carries no port.
    const [endpoint] = [...endpoints];
    expect(endpoint).not.toMatch(/localhost:\d+/);

    // And the weak test genuinely fails to catch a tax change.
    expect(
      report.outcomes.some(
        (o) => o.mutation?.fieldPath === "tax" && o.status === "missed",
      ),
    ).toBe(true);
  }, 180_000);
});

describe("changes-driven scan", () => {
  it.each([false, true])(
    "reruns attributed tests from a spaced path with a strong assertion: %s",
    async (strong) => {
      const scratchDir = mkdtempSync(join(tmpdir(), "mp scan (spaces) % "));
      const testPath = join(scratchDir, "test", "order (gross).test.mjs");
      const changesPath = join(scratchDir, "changes.json");
      try {
        mkdirSync(join(scratchDir, "test"));
        writeFileSync(
          join(scratchDir, "package.json"),
          JSON.stringify({ scripts: { test: "node --test" }, type: "module" }),
        );
        writeFileSync(
          changesPath,
          JSON.stringify({
            api: "api.example.test",
            changes: [
              {
                endpoint: "GET /order",
                field: "amount",
                kind: "unit-change",
                factor: 100,
              },
            ],
          }),
        );
        writeFileSync(
          testPath,
          [
            'import assert from "node:assert/strict";',
            'import test from "node:test";',
            "globalThis.fetch = async () => new Response(JSON.stringify({ amount: 12 }));",
            'test("checks an order", async () => {',
            '  const body = await (await fetch("https://api.example.test/order")).json();',
            strong ? "  assert.equal(body.amount, 12);" : "  assert.ok(body);",
            "});",
          ].join("\n"),
        );
        const report = await runMutations(scratchDir, changesPath);
        expect(report.verdict).toBe(strong ? "protected" : "gaps");
        expect(report.outcomes).toHaveLength(1);
        expect(report.outcomes[0]).toMatchObject({
          status: strong ? "caught" : "missed",
          testFiles: [realpathSync(testPath)],
          testsRun: 1,
        });
      } finally {
        rmSync(scratchDir, { recursive: true, force: true });
      }
    },
  );

  it("emits a gaps JSON verdict and exits 1 on a weak test suite", async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "mp-changes-weak-"));
    try {
      cpSync(resolve("test/integration/changes-project"), scratchDir, {
        recursive: true,
      });
      rmSync(join(scratchDir, "node_modules"), {
        recursive: true,
        force: true,
      });
      symlinkSync(
        join(repoRoot, "node_modules"),
        join(scratchDir, "node_modules"),
      );
      rmSync(join(scratchDir, "test/strong.test.ts"));

      let exitCode = 0;
      let stdout = "";
      try {
        const res = await execFileAsync(
          "node",
          [
            "--import",
            tsxLoader,
            join(repoRoot, "src/cli/index.ts"),
            "scan",
            "--changes",
            "changes.json",
            "--json",
          ],
          { cwd: scratchDir, timeout: 120_000 },
        );
        stdout = res.stdout;
      } catch (error: unknown) {
        if (error && typeof error === "object" && "code" in error) {
          exitCode = (error as { code: number }).code;
          stdout = (error as { stdout?: string }).stdout ?? "";
        }
      }

      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({ verdict: "gaps" });
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("emits a protected JSON verdict and exits 0 on a strong test suite", async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "mp-changes-strong-"));
    try {
      cpSync(resolve("test/integration/changes-project"), scratchDir, {
        recursive: true,
      });
      rmSync(join(scratchDir, "node_modules"), {
        recursive: true,
        force: true,
      });
      symlinkSync(
        join(repoRoot, "node_modules"),
        join(scratchDir, "node_modules"),
      );
      rmSync(join(scratchDir, "test/weak.test.ts"));

      const { stdout } = await execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          join(repoRoot, "src/cli/index.ts"),
          "scan",
          "--changes",
          "changes.json",
          "--json",
        ],
        { cwd: scratchDir, timeout: 120_000 },
      );

      expect(JSON.parse(stdout)).toMatchObject({ verdict: "protected" });
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }, 120_000);
});
