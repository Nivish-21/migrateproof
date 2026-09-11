import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runBackendProcess } from "./runBackendProcess.js";
import type {
  PatchBackend,
  PatchBackendInput,
  PatchBackendResult,
} from "../types.js";

const execFileAsync = promisify(execFile);
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;

// Verified against Claude Code 2.1.236: `claude -p <prompt> --permission-mode
// bypassPermissions --allowedTools "Bash,Read,Edit,Write"`. Worktree
// isolation (see runPatch.ts) is what makes bypassPermissions safe here —
// the agent can only touch a disposable worktree, never the real checkout.
export class ClaudeCodePatchBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    const { stdout, stderr } = await runBackendProcess({
      label: "claude",
      command: "claude",
      args: [
        "-p",
        input.instructions,
        "--permission-mode",
        "bypassPermissions",
        "--allowedTools",
        "Bash,Read,Edit,Write",
      ],
      cwd: input.worktreeDir,
      timeoutMs: CLAUDE_TIMEOUT_MS,
    });
    const { stdout: changedFiles } = await execFileAsync(
      "git",
      ["diff", "--name-only"],
      { cwd: input.worktreeDir },
    );
    return {
      appliedFiles: changedFiles.split("\n").filter(Boolean),
      rawLog: `${stdout}\n${stderr}`,
    };
  }
}
