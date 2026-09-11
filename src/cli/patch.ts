import { Command } from "commander";
import { UsageError } from "../errors.js";
import { resolveFixtureDir } from "../fixtures/resolveFixtureDir.js";
import { ClaudeCodePatchBackend } from "../patch/backends/claudeCode.js";
import { CodexPatchBackend } from "../patch/backends/codex.js";
import { CopilotCliPatchBackend } from "../patch/backends/copilotCli.js";
import { CursorAgentPatchBackend } from "../patch/backends/cursorAgent.js";
import { GeminiCliPatchBackend } from "../patch/backends/geminiCli.js";
import { OpenCodePatchBackend } from "../patch/backends/opencode.js";
import type { PatchBackend } from "../patch/types.js";
import { runPatch } from "../patch/runPatch.js";

const BACKEND_FACTORIES: Record<string, () => PatchBackend> = {
  codex: () => new CodexPatchBackend(),
  claude: () => new ClaudeCodePatchBackend(),
  gemini: () => new GeminiCliPatchBackend(),
  "cursor-agent": () => new CursorAgentPatchBackend(),
  copilot: () => new CopilotCliPatchBackend(),
  opencode: () => new OpenCodePatchBackend(),
};

export function registerPatchCommand(program: Command): void {
  program
    .command("patch <fixture-dir>")
    .option(
      "--patch-backend <backend>",
      `one of: ${Object.keys(BACKEND_FACTORIES).join(", ")}`,
      "codex",
    )
    .action(
      async (fixtureDirArg: string, options: { patchBackend: string }) => {
        try {
          const factory = BACKEND_FACTORIES[options.patchBackend];
          if (!factory) {
            throw new UsageError(
              `--patch-backend must be one of: ${Object.keys(BACKEND_FACTORIES).join(", ")}`,
            );
          }
          const fixtureDir = resolveFixtureDir(process.cwd(), fixtureDirArg);
          const result = await runPatch(process.cwd(), fixtureDir, factory());
          console.error(result.rawLog);
          if (result.accepted) {
            console.log(
              [
                "patch accepted — review and merge manually:",
                `  cd ${result.worktreeDir}`,
                "  git diff",
                "  # copy/merge the change into your branch, then:",
                `  git worktree remove --force ${result.worktreeDir}`,
              ].join("\n"),
            );
            process.exit(0);
          }
          console.error("patch rejected — rerun did not pass");
          process.exit(1);
        } catch (error) {
          if (error instanceof UsageError) {
            console.error(`Error: ${error.message}`);
            process.exit(2);
          }
          throw error;
        }
      },
    );
}
