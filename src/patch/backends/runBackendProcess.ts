import { execFile, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { UsageError } from "../../errors.js";

const DEFAULT_BACKEND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BACKEND_TIMEOUT_MS = 2_147_483_647;
const TERMINATION_GRACE_MS = 250;
const TERMINATION_COMMAND_TIMEOUT_MS = 5_000;
const SHUTDOWN_DRAIN_MS = 1_000;

export class BackendShutdownError extends UsageError {}
const MAX_CAPTURE_BYTES = 1024 * 1024;

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

const BACKEND_AUTH_ENVIRONMENT_KEYS: Record<string, readonly string[]> = {
  codex: [
    "CODEX_HOME",
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT_ID",
  ],
  claude: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ],
  gemini: [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_GENAI_USE_VERTEXAI",
  ],
  "cursor-agent": ["CURSOR_API_KEY"],
  copilot: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
  opencode: [
    "ANTHROPIC_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_REGION",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "CEREBRAS_API_KEY",
    "COHERE_API_KEY",
    "DEEPSEEK_API_KEY",
    "FIREWORKS_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
    "PERPLEXITY_API_KEY",
    "TOGETHER_API_KEY",
    "XAI_API_KEY",
  ],
};

interface CapturedOutput {
  chunks: Buffer[];
  size: number;
}

function createPlatformEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of PLATFORM_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function createBackendEnvironment(label: string): NodeJS.ProcessEnv {
  const environment = createPlatformEnvironment();
  for (const key of BACKEND_AUTH_ENVIRONMENT_KEYS[label] ?? []) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function captureChunk(output: CapturedOutput, chunk: Buffer | string): void {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = MAX_CAPTURE_BYTES - output.size;
  if (remaining <= 0) return;
  const captured = buffer.subarray(0, remaining);
  output.chunks.push(captured);
  output.size += captured.byteLength;
}

function formatOutput(output: CapturedOutput): string {
  return Buffer.concat(output.chunks).toString("utf8");
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function processFailure(
  input: RunBackendProcessInput,
  error: unknown,
): UsageError {
  const platformHint =
    process.platform === "win32"
      ? " Windows batch launchers are unsupported without a shell; install a native executable on PATH or run MigrateProof and the backend inside WSL."
      : "";
  if (isErrnoCode(error, "ENOENT")) {
    return new UsageError(
      `${input.label} CLI not found on PATH. Install it before using --patch-backend ${input.label}.${platformHint}`,
    );
  }
  return new UsageError(
    `${input.label} patch backend could not be started.${platformHint}`,
  );
}

function signalPosixTree(pid: number, signal: NodeJS.Signals): void {
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

async function terminateProcessTree(
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

function timeoutError(input: RunBackendProcessInput): BackendShutdownError {
  return new BackendShutdownError(
    `${input.label} patch backend did not finish within ${input.timeoutMs / 60000} minutes. Termination was attempted, but detached descendants may still be running. It may have made partial changes in the worktree.`,
  );
}

export function resolveBackendTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.MIGRATEPROOF_BACKEND_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_BACKEND_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAX_BACKEND_TIMEOUT_MS
    ? parsed
    : DEFAULT_BACKEND_TIMEOUT_MS;
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
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs <= 0 ||
    input.timeoutMs > MAX_BACKEND_TIMEOUT_MS
  ) {
    throw new UsageError(
      `backend timeout must be a positive integer no greater than ${MAX_BACKEND_TIMEOUT_MS}`,
    );
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(input.command)) {
    throw processFailure(input, new Error("unsupported batch launcher"));
  }
  console.error(
    `[${input.label}] running patch backend (up to ${input.timeoutMs / 60000} min, this may take a while)...`,
  );

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: createBackendEnvironment(input.label),
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(processFailure(input, error));
      return;
    }

    const stdout: CapturedOutput = { chunks: [], size: 0 };
    const stderr: CapturedOutput = { chunks: [], size: 0 };
    child.stdout?.on("data", (chunk: Buffer | string) =>
      captureChunk(stdout, chunk),
    );
    child.stderr?.on("data", (chunk: Buffer | string) =>
      captureChunk(stderr, chunk),
    );

    let settled = false;
    let timedOut = false;
    let closed = false;
    let termination: Promise<void> | null = null;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    function failShutdown(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(shutdownTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      reject(
        new BackendShutdownError(
          `${input.label} backend shutdown could not be confirmed; a process may still be running.`,
        ),
      );
    }
    const timer = setTimeout(() => {
      timedOut = true;
      const shutdownLimit =
        TERMINATION_GRACE_MS +
        SHUTDOWN_DRAIN_MS +
        (process.platform === "win32" ? 2 * TERMINATION_COMMAND_TIMEOUT_MS : 0);
      shutdownTimer = setTimeout(failShutdown, shutdownLimit);
      if (child.pid !== undefined) {
        termination = terminateProcessTree(child.pid, () => closed).catch(
          failShutdown,
        );
      }
    }, input.timeoutMs);

    child.once("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(shutdownTimer);
      reject(processFailure(input, error));
    });

    child.once("close", (code, signal) => {
      closed = true;
      void (async () => {
        if (settled) return;
        clearTimeout(timer);
        if (termination) {
          await termination;
        }
        if (settled) return;
        clearTimeout(shutdownTimer);
        settled = true;
        if (timedOut) {
          reject(timeoutError(input));
        } else if (code !== 0) {
          reject(
            new UsageError(
              `${input.label} patch backend failed (exit code ${code ?? "unknown"}${signal ? `, signal ${signal}` : ""}).`,
            ),
          );
        } else {
          resolve({
            stdout: formatOutput(stdout),
            stderr: formatOutput(stderr),
          });
        }
      })();
    });
  });
}
