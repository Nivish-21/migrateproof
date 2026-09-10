// test/cli/diagnose.command.test.ts
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

describe("diagnose command", () => {
  it("classifies the checkout-example's v2 change and exits 1", async () => {
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          "src/cli/index.ts",
          "diagnose",
          "fixtures/checkout-example",
        ],
        { cwd: repoRoot },
      );
      throw new Error("expected diagnose to exit 1 on a failing v2");
    } catch (error) {
      const commandError = error as { code: number; stdout: string };
      expect(commandError.code).toBe(1);
      expect(commandError.stdout).toContain("tax");
    }
  });

  it("supports --json", async () => {
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          "src/cli/index.ts",
          "diagnose",
          "fixtures/checkout-example",
          "--json",
        ],
        { cwd: repoRoot },
      );
      throw new Error("expected diagnose --json to exit 1 on a failing v2");
    } catch (error) {
      const commandError = error as { code: number; stdout: string };
      expect(commandError.code).toBe(1);
      const parsed = JSON.parse(commandError.stdout);
      expect(parsed.passed).toBe(false);
      expect(parsed.verdicts).toHaveProperty("tax");
    }
  });
});
