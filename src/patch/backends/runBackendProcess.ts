import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UsageError } from "../../errors.js";

const execFileAsync = promisify(execFile);

export interface RunBackendProcessInput {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface RunBackendProcessResult {
  stdout: string;
  stderr: string;
}

export async function runBackendProcess(
  input: RunBackendProcessInput,
): Promise<RunBackendProcessResult> {
  console.error(
    `[${input.label}] running patch backend (up to ${input.timeoutMs / 60000} min, this may take a while)...`,
  );
  try {
    return await execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      timeout: input.timeoutMs,
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "killed" in error &&
      (error as { killed?: boolean }).killed
    ) {
      throw new UsageError(
        `${input.label} patch backend did not finish within ${input.timeoutMs / 60000} minutes and was terminated. It may have made partial changes in the worktree.`,
      );
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new UsageError(
        `${input.label} CLI not found on PATH. Install it before using --patch-backend ${input.label}.`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${input.label} patch backend failed: ${message}`);
  }
}
