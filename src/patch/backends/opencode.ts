import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runBackendProcess } from "./runBackendProcess.js";
import type {
  PatchBackend,
  PatchBackendInput,
  PatchBackendResult,
} from "../types.js";

const execFileAsync = promisify(execFile);
const OPENCODE_TIMEOUT_MS = 10 * 60 * 1000;

// Verified against opencode 1.18.20: `opencode run <prompt> --dir <dir>
// --auto`. `-p` is basic-auth password on this CLI, not prompt — the
// message is a positional argument instead. Caught by actually running
// `opencode run --help`, not by trusting third-party documentation.
export class OpenCodePatchBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    const { stdout, stderr } = await runBackendProcess({
      label: "opencode",
      command: "opencode",
      args: ["run", input.instructions, "--dir", input.worktreeDir, "--auto"],
      cwd: input.worktreeDir,
      timeoutMs: OPENCODE_TIMEOUT_MS,
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
