import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

describe("replay command", () => {
  it("reports an outside-fixtures path as a usage error", async () => {
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          "tsx",
          "src/cli/index.ts",
          "replay",
          "../outside",
          "--version",
          "v1",
        ],
        { cwd: repoRoot },
      );
      throw new Error("expected replay to reject an outside-fixtures path");
    } catch (error) {
      const commandError = error as { code: number; stderr: string };
      expect(commandError.code).toBe(2);
      expect(commandError.stderr).toContain("Error: <fixture-dir>");
      expect(commandError.stderr).not.toContain("UsageError:");
    }
  });

  it("reports --all with zero discovered fixtures as a usage error", async () => {
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          "tsx",
          resolve(repoRoot, "src/cli/index.ts"),
          "replay",
          "--version",
          "v1",
          "--all",
        ],
        { cwd: resolve(repoRoot, "test/fixtures-empty-dir") },
      );
      throw new Error("expected --all with no fixtures to be rejected");
    } catch (error) {
      const commandError = error as { code: number; stderr: string };
      expect(commandError.code).toBe(2);
      expect(commandError.stderr).toContain("no fixtures");
    }
  });

  it("rejects <fixture-dir> combined with --all", async () => {
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          "tsx",
          "src/cli/index.ts",
          "replay",
          "fixtures/checkout-example",
          "--version",
          "v1",
          "--all",
        ],
        { cwd: repoRoot },
      );
      throw new Error("expected <fixture-dir> + --all to be rejected");
    } catch (error) {
      const commandError = error as { code: number; stderr: string };
      expect(commandError.code).toBe(2);
      expect(commandError.stderr).toContain("--all");
    }
  });

  it("reports syntactically invalid fixture.yaml as a usage error, not a stack trace", async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "mp-badyaml-cli-"));
    const fixtureDir = join(scratchDir, "fixtures", "bad");
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, "fixture.yaml"),
      "schemaVersion: 1\nname: [unterminated\n",
    );
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          join(repoRoot, "src/cli/index.ts"),
          "replay",
          "fixtures/bad",
          "--version",
          "v1",
        ],
        { cwd: scratchDir },
      );
      throw new Error("expected replay to reject invalid YAML");
    } catch (error) {
      const commandError = error as { code: number; stderr: string };
      expect(commandError.code).toBe(2);
      expect(commandError.stderr).toContain("Invalid YAML syntax");
      expect(commandError.stderr).not.toContain("YAMLException");
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
