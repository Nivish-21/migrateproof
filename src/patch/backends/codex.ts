import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UsageError } from "../../errors.js";
import type {
  PatchBackend,
  PatchBackendInput,
  PatchBackendResult,
} from "../types.js";

const execFileAsync = promisify(execFile);

// Verified against codex-cli 0.152.1: `codex exec -C <worktree> <prompt>`.
export class CodexPatchBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    try {
      const { stdout, stderr } = await execFileAsync(
        "codex",
        ["exec", "-C", input.worktreeDir, input.instructions],
        { cwd: input.worktreeDir },
      );
      const { stdout: changedFiles } = await execFileAsync(
        "git",
        ["diff", "--name-only"],
        { cwd: input.worktreeDir },
      );
      return {
        appliedFiles: changedFiles.split("\n").filter(Boolean),
        rawLog: `${stdout}\n${stderr}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UsageError(`Codex patch backend failed: ${message}`);
    }
  }
}
