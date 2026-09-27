import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerPatchCommand } from "../../src/cli/patch.js";
import { runPatch } from "../../src/patch/runPatch.js";

vi.mock("../../src/patch/runPatch.js", () => ({ runPatch: vi.fn() }));

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

describe("patch command --patch-backend validation", () => {
  it.each(["not-a-real-backend", "toString", "__proto__"])(
    "rejects backend %s with a UsageError listing all six valid options",
    async (backend) => {
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
            backend,
          ],
          { cwd: repoRoot },
        ),
      ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining(
          "--patch-backend must be one of: codex, claude, gemini, cursor-agent, copilot, opencode",
        ),
      });
    },
  );

  it("does not print raw backend logs", async () => {
    vi.mocked(runPatch).mockResolvedValue({
      accepted: true,
      rawLog: "backend-secret-log",
      worktreeDir: "/tmp/patch-worktree",
    });
    const stderr = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    const program = new Command();
    registerPatchCommand(program);

    try {
      await expect(
        program.parseAsync(
          ["patch", "fixtures/checkout-example", "--patch-backend", "claude"],
          { from: "user" },
        ),
      ).rejects.toThrow("process.exit called");
      expect(stderr).not.toHaveBeenCalledWith(
        expect.stringContaining("backend-secret-log"),
      );
      expect(stdout).toHaveBeenCalledWith(
        expect.stringContaining("git diff HEAD"),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});
