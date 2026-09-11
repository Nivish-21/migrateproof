import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

describe("patch command --patch-backend validation", () => {
  it("rejects an unknown backend with a UsageError listing all six valid options", async () => {
    await expect(
      execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          join(repoRoot, "src/cli/index.ts"),
          "patch",
          "fixtures/checkout-example",
          "--patch-backend",
          "not-a-real-backend",
        ],
        { cwd: repoRoot },
      ),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining(
        "--patch-backend must be one of: codex, claude, gemini, cursor-agent, copilot, opencode",
      ),
    });
  });
});
