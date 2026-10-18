import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export const TERMINATION_GRACE_MS = 250;
export const TERMINATION_COMMAND_TIMEOUT_MS = 5_000;

const PLATFORM_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TMP",
  "TEMP",
  "TMPDIR",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "USER",
  "LOGNAME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
] as const;

export function createPlatformEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of PLATFORM_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export function isErrnoCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

// Requires the process to have been spawned with `detached: true`, which
// makes its pid the process-group id.
export function signalPosixTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!isErrnoCode(error, "ESRCH")) throw error;
  }
}

function runTaskkill(pid: number, force: boolean): Promise<void> {
  const args = ["/pid", String(pid), "/T"];
  if (force) args.push("/F");
  return new Promise((resolve, reject) => {
    execFile(
      "taskkill",
      args,
      {
        env: createPlatformEnvironment(),
        maxBuffer: 64 * 1024,
        shell: false,
        timeout: TERMINATION_COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

export async function terminateProcessTree(
  pid: number,
  hasClosed: () => boolean,
): Promise<void> {
  let gracefulTerminationFailed = false;
  try {
    if (process.platform === "win32") {
      await runTaskkill(pid, false);
    } else {
      signalPosixTree(pid, "SIGTERM");
    }
  } catch {
    gracefulTerminationFailed = true;
  }
  await delay(TERMINATION_GRACE_MS);
  if (process.platform === "win32" && !gracefulTerminationFailed && hasClosed())
    return;
  try {
    if (process.platform === "win32") {
      await runTaskkill(pid, true);
    } else {
      signalPosixTree(pid, "SIGKILL");
    }
  } catch {
    throw new Error(
      gracefulTerminationFailed
        ? "graceful and forced process-tree termination failed"
        : "forced process-tree termination failed",
    );
  }
}
