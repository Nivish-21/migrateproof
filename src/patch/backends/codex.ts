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

// Verified against codex-cli 0.152.1: `codex exec -C <worktree> <prompt>`.
export class CodexPatchBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    const { stdout, stderr } = await runBackendProcess({
      label: "codex",
      command: "codex",
      args: ["exec", "-C", input.worktreeDir, input.instructions],
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
