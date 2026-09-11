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

describe("scan command", () => {
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
});
