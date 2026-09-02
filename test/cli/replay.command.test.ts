import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(".");

describe("replay command", () => {
  it("reports an outside-fixtures path as a usage error", async () => {
    try {
      await execFileAsync(
        "node",
        ["dist/cli/index.js", "replay", "../outside", "--version", "v1"],
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
});
