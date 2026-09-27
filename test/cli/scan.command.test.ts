// test/cli/scan.command.test.ts
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

async function runScan(dir: string): Promise<{
  exitCode: number;
  stdout: string;
}> {
  try {
    const result = await execFileAsync(
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
      { cwd: dir },
    );
    return { exitCode: 0, stdout: result.stdout };
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      return {
        exitCode: (error as { code: number }).code,
        stdout: (error as { stdout?: string }).stdout ?? "",
      };
    }
    throw error;
  }
}

describe("scan command", () => {
  it("rejects --fix without documented changes before running tests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-fix-usage-"));
    try {
      await expect(
        execFileAsync(
          "node",
          [
            "--import",
            tsxLoader,
            join(repoRoot, "src/cli/index.ts"),
            "scan",
            "--fix",
          ],
          { cwd: dir },
        ),
      ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining("--fix requires --changes"),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown fix backend before scanning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-fix-backend-"));
    try {
      await expect(
        execFileAsync(
          "node",
          [
            "--import",
            tsxLoader,
            join(repoRoot, "src/cli/index.ts"),
            "scan",
            "--fix",
            "--changes",
            "changes.json",
            "--patch-backend",
            "unknown",
          ],
          { cwd: dir },
        ),
      ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining("--patch-backend must be one of"),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with a clear message when the project has no test script", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-scan-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { build: "tsc" } }),
    );
    try {
      await expect(
        execFileAsync(
          "node",
          ["--import", tsxLoader, join(repoRoot, "src/cli/index.ts"), "scan"],
          { cwd: dir },
        ),
      ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining('no "test" script'),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bare invocation with no arguments routes to scan and exits 2 when no test script", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-scan-bare-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { build: "tsc" } }),
    );
    try {
      await expect(
        execFileAsync(
          "node",
          ["--import", tsxLoader, join(repoRoot, "src/cli/index.ts")],
          { cwd: dir },
        ),
      ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining('no "test" script'),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with an incomplete JSON verdict when the baseline fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-scan-baseline-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "x",
        scripts: { test: 'node -e "process.exit(1)"' },
      }),
    );
    writeFileSync(
      join(dir, "changes.json"),
      JSON.stringify({
        api: "api.example.com",
        changes: [{ endpoint: "GET /orders", field: "id", kind: "removed" }],
      }),
    );
    try {
      const baselineFailure = await runScan(dir);
      expect(baselineFailure.exitCode).toBe(2);
      expect(JSON.parse(baselineFailure.stdout)).toMatchObject({
        verdict: "incomplete",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
