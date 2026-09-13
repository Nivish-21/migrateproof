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

// Verified against gemini-cli 0.58.0: `gemini -p <prompt> --yolo`.
export class GeminiCliPatchBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    const { stdout, stderr } = await runBackendProcess({
      label: "gemini",
      command: "gemini",
      args: ["-p", input.instructions, "--yolo"],
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
