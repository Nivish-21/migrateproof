import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(".");

describe("capture command", () => {
  it("reports an unreachable --url as a usage error, not a crash", async () => {
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          "tsx",
          "src/cli/index.ts",
          "capture",
          "fixtures/checkout-example",
          "--as",
          "v1",
          "--url",
          "http://127.0.0.1:1/unreachable",
        ],
        { cwd: repoRoot },
      );
      throw new Error("expected capture to reject an unreachable --url");
    } catch (error) {
      const commandError = error as { code: number; stderr: string };
      expect(commandError.code).toBe(2);
      expect(commandError.stderr).toContain("Error: --url");
      expect(commandError.stderr).not.toContain("TypeError");
      expect(commandError.stderr).not.toContain(" at ");
    }
  });

  it("rejects --url combined with --from-file", async () => {
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          "tsx",
          "src/cli/index.ts",
          "capture",
          "fixtures/checkout-example",
          "--as",
          "v1",
          "--url",
          "http://127.0.0.1:1/unreachable",
          "--from-file",
          "/tmp/does-not-exist.json",
        ],
        { cwd: repoRoot },
      );
      throw new Error("expected --url + --from-file to be rejected");
    } catch (error) {
      const commandError = error as { code: number; stderr: string };
      expect(commandError.code).toBe(2);
      expect(commandError.stderr).toContain("--url and --from-file");
    }
  });
});
