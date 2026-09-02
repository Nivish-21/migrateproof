import { Command } from "commander";
import { UsageError } from "../errors.js";
import { resolveFixtureDir } from "../fixtures/resolveFixtureDir.js";
import { CodexPatchBackend } from "../patch/backends/codex.js";
import { runPatch } from "../patch/runPatch.js";

export function registerPatchCommand(program: Command): void {
  program
    .command("patch <fixture-dir>")
    .option(
      "--patch-backend <backend>",
      "codex (default, only option in MVP)",
      "codex",
    )
    .action(
      async (fixtureDirArg: string, options: { patchBackend: string }) => {
        try {
          if (options.patchBackend !== "codex") {
            throw new UsageError(
              "--patch-backend must be 'codex' (only backend supported in MVP)",
            );
          }
          const fixtureDir = resolveFixtureDir(process.cwd(), fixtureDirArg);
          const result = await runPatch(
            process.cwd(),
            fixtureDir,
            new CodexPatchBackend(),
          );
          console.error(result.rawLog);
          if (result.accepted) {
            console.log(
              "patch accepted — review the worktree diff and merge manually",
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
