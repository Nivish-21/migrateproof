import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  resolveBackendTimeoutMs,
  runBackendProcess,
} from "./runBackendProcess.js";
import type {
  PatchBackend,
  PatchBackendInput,
  PatchBackendResult,
} from "../types.js";

const execFileAsync = promisify(execFile);

// This backend grants arbitrary host command access. Use it only with trusted
// local repositories; the worktree is not a sandbox.
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
      timeoutMs: resolveBackendTimeoutMs(),
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
