import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UsageError } from "../../errors.js";

const execFileAsync = promisify(execFile);

const DEFAULT_BACKEND_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * How long a patch backend may run before it is killed.
 *
 * Backends are external AI coding CLIs; how long they legitimately need
 * varies by model, prompt size, and network. Ten minutes suits most runs, but
 * a slow backend needs more and an unattended CI job usually wants less, so
 * `MIGRATEPROOF_BACKEND_TIMEOUT_MS` overrides it. A value that is not a
 * positive number is ignored rather than taken literally, since a zero or
 * negative timeout would kill every backend the instant it started.
 */
export function resolveBackendTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.MIGRATEPROOF_BACKEND_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_BACKEND_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BACKEND_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

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
