// test/integration/scan.integration.test.ts
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runMutations } from "../../src/mutation/runMutations.js";
import { hasGaps } from "../../src/mutation/report.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

describe("scan integration", () => {
  it("reports gaps for a deliberately weak test suite", async () => {
    const report = await runMutations(resolve("test/integration/weak-project"));
    expect(hasGaps(report)).toBe(true);
    const taxGaps = report.outcomes.filter(
      (o) => o.mutation.fieldPath === "tax" && o.classification === "gap",
    );
    expect(taxGaps.length).toBeGreaterThan(0);
  }, 120_000);

  it("reports no tax gaps for a deliberately strong test suite", async () => {
    const report = await runMutations(
      resolve("test/integration/strong-project"),
    );
    const taxGaps = report.outcomes.filter(
      (o) => o.mutation.fieldPath === "tax" && o.classification === "gap",
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

    expect(hasGaps(report)).toBe(true);

    // One logical endpoint, not one per port.
    const endpoints = new Set(report.outcomes.map((o) => o.endpoint));
    expect(endpoints.size).toBe(1);

    // The surviving identity carries no port.
    const [endpoint] = [...endpoints];
    expect(endpoint).not.toMatch(/localhost:\d+/);

    // And the weak test genuinely fails to catch a tax change.
    expect(
      report.outcomes.some(
        (o) => o.mutation.fieldPath === "tax" && o.classification === "gap",
      ),
    ).toBe(true);
  }, 180_000);
});

describe("changes-driven scan", () => {
  it(
    "exits 1 and names the mutated field on a weak test suite",
    async () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "mp-changes-weak-"));
      try {
        cpSync(resolve("test/integration/changes-project"), scratchDir, {
          recursive: true,
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
        expect(stdout).toContain("amount");
      } finally {
        rmSync(scratchDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it(
    "exits 0 on a strong test suite that catches the change",
    async () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "mp-changes-strong-"));
      try {
        cpSync(resolve("test/integration/changes-project"), scratchDir, {
          recursive: true,
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
          ],
          { cwd: scratchDir, timeout: 120_000 },
        );

        expect(stdout).toContain("no gaps");
      } finally {
        rmSync(scratchDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
