import { spawn } from "node:child_process";
import { setPriority } from "node:os";
import {
  isErrnoCode,
  signalPosixTree,
  terminateProcessTree,
} from "./terminateProcessTree.js";

// Test runs are background work: keep the user's machine responsive.
const BACKGROUND_PRIORITY = 10;
// Keep the tail: runner summaries (pass/fail counts) are printed last.
const MAX_CAPTURE_CHARS = 8 * 1024 * 1024;
// After the command exits, how long to wait for its output pipes to drain.
const OUTPUT_DRAIN_MS = 2_000;

export interface RunTestProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface RunTestProcessOutput {
  stdout: string;
  stderr: string;
}

/** Mirrors the error shape of promisified `execFile` so callers keep working. */
export interface RunTestProcessError extends RunTestProcessOutput {
  code: number | null;
  signal: NodeJS.Signals | null;
  killed: boolean;
}

// Process groups still running, so an interrupted CLI can take them down too.
const activeGroups = new Set<number>();

function killActiveGroups(): void {
  for (const pid of activeGroups) {
    try {
      signalPosixTree(pid, "SIGKILL");
    } catch {
      // Exiting anyway; keep going so every other group is still signalled.
    }
  }
  activeGroups.clear();
}

let interruptHandlersInstalled = false;
function installInterruptHandlers(): void {
  if (interruptHandlersInstalled || process.platform === "win32") return;
  interruptHandlersInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      killActiveGroups();
      process.kill(process.pid, signal);
    });
  }
  process.once("exit", killActiveGroups);
}

function appendTail(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  return next.length > MAX_CAPTURE_CHARS
    ? next.slice(next.length - MAX_CAPTURE_CHARS)
    : next;
}

/**
 * Runs a target project's test command with a hard time limit, at background
 * priority, in its own process group. Whatever happens, timeout, failure or
 * success, every process the command started is killed before this settles:
 * test runners routinely leave workers or servers (e.g. mongod) behind.
 *
 * Windows has no process groups; there the command's tree is killed only on
 * timeout, through taskkill.
 */
export function runTestProcess(
  command: string,
  args: string[],
  options: RunTestProcessOptions,
): Promise<RunTestProcessOutput> {
  installInterruptHandlers();
  return new Promise((resolve, reject) => {
    const posix = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: posix,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const pid = child.pid;
    if (pid !== undefined) {
      if (posix) activeGroups.add(pid);
      try {
        setPriority(pid, BACKGROUND_PRIORITY);
      } catch {
        // Best effort: the process may already have exited. The time limit
        // and cleanup below still apply.
      }
    }

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendTail(stdout, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendTail(stderr, chunk);
    });

    let timedOut = false;
    let exited = false;
    let settled = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;

    function killLeftovers(): void {
      if (pid === undefined || !activeGroups.delete(pid)) return;
      try {
        signalPosixTree(pid, "SIGKILL");
      } catch (error) {
        // macOS answers EPERM for a group whose members are all zombies:
        // nothing is left running to kill.
        if (!isErrnoCode(error, "EPERM")) throw error;
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      if (pid === undefined) return;
      void terminateProcessTree(pid, () => exited)
        .catch(() => {
          // Fall through: the drain timer below still settles the promise.
        })
        .finally(() => {
          if (!exited) drainTimer ??= setTimeout(finish, OUTPUT_DRAIN_MS);
        });
    }, options.timeoutMs);

    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      killLeftovers();
      if (exitCode === 0 && !timedOut) {
        resolve({ stdout, stderr });
        return;
      }
      const details: RunTestProcessError = {
        code: timedOut ? null : exitCode,
        signal: exitSignal,
        killed: timedOut,
        stdout,
        stderr,
      };
      reject(Object.assign(new Error("test command failed"), details));
    }

    child.once("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      killLeftovers();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      // A leftover grandchild can hold the output pipes open, so `close`
      // would wait for it. Kill the group now; `close` then follows quickly.
      killLeftovers();
      drainTimer ??= setTimeout(finish, OUTPUT_DRAIN_MS);
    });
    child.once("close", finish);
  });
}
