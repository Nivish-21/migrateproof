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

// Verified against GitHub Copilot CLI 1.0.73: `copilot -p <prompt>
// --allow-all-tools`.
export class CopilotCliPatchBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    const { stdout, stderr } = await runBackendProcess({
      label: "copilot",
      command: "copilot",
      args: ["-p", input.instructions, "--allow-all-tools"],
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
