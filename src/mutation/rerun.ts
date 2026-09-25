import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { UsageError } from "../errors.js";
import { resolveTestCommand, type ObservedCall } from "./observe.js";

const execFileAsync = promisify(execFile);
const RERUN_TIMEOUT_MS = 60 * 1000;

export type RerunResult =
  | { kind: "completed"; testsRun: number; testsFailed: number }
  | {
      kind: "incomplete";
      testsRun: number;
      reason: string;
      nextAction: string;
    };

function matchCount(output: string, pattern: RegExp): number {
  const match = output.match(pattern);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}

export function parseCounts(output: string): {
  testsRan: number;
  testsFailed: number;
} {
  const wordyFailed = matchCount(output, /(\d+)\s+failed/i);
  const wordyPassed = matchCount(output, /(\d+)\s+passed/i);
  const jestTotal = matchCount(output, /Tests:\s+.*(?:(\d+)\s+total)/i);
  const nodeTotal = matchCount(output, /\btests\s+(\d+)/i);
  const nodeFailed = matchCount(output, /\bfail\s+(\d+)/i);

  return {
    testsRan: Math.max(wordyFailed + wordyPassed, jestTotal, nodeTotal),
    testsFailed: Math.max(wordyFailed, nodeFailed),
  };
}

function incomplete(
  testsRun: number,
  reason: string,
  nextAction: string,
): RerunResult {
  return { kind: "incomplete", testsRun, reason, nextAction };
}

function hasConfirmation(path: string): boolean {
  try {
    JSON.parse(readFileSync(path, "utf-8"));
    return true;
  } catch {
    return false;
  }
}

export async function rerun(
  projectRoot: string,
  call: ObservedCall,
  mutatedBody: unknown,
): Promise<RerunResult> {
  const baseArgv = resolveTestCommand(join(projectRoot, "package.json"));
  const [command, ...baseArgs] = baseArgv;
  if (command === undefined) {
    throw new UsageError("could not resolve a test command");
  }
  if (call.touchingTests.length === 0) {
    throw new UsageError(
      `cannot re-run mutations for ${call.method} ${call.url}: no test could be attributed to it, ` +
        "so the re-run cannot be scoped and would execute the entire suite once per mutation.",
    );
  }

  const args = [...baseArgs, "--", ...call.touchingTests];
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const tsSetup = join(thisDir, "rerunSetup.ts");
  const jsSetup = join(thisDir, "rerunSetup.js");
  const setupModule = existsSync(tsSetup) ? tsSetup : jsSetup;
  const resultPath = join(
    projectRoot,
    "node_modules",
    `.migrateproof-mutation-${randomUUID()}.json`,
  );
  mkdirSync(dirname(resultPath), { recursive: true });
  rmSync(resultPath, { force: true });

  const mutationConfig = JSON.stringify({
    method: call.method,
    url: call.url,
    mutatedBody,
  });

  let output = "";
  let executionError:
    | {
        killed?: unknown;
        code?: unknown;
        signal?: unknown;
      }
    | undefined;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: projectRoot,
      timeout: RERUN_TIMEOUT_MS,
      env: {
        ...process.env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --import ${setupModule}`.trim(),
        MIGRATEPROOF_MUTATION_CONFIG: mutationConfig,
        MIGRATEPROOF_MUTATION_RESULT_PATH: resultPath,
      },
    });
    output = `${stdout}\n${stderr}`;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new UsageError(
        `could not run "${command}" — is npm installed and on PATH?`,
      );
    }
    if (error && typeof error === "object") {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        killed?: unknown;
        code?: unknown;
        signal?: unknown;
      };
      output = `${execError.stdout ?? ""}\n${execError.stderr ?? ""}`;
      executionError = execError;
    }
  }

  const { testsRan, testsFailed } = parseCounts(output);
  const confirmed = hasConfirmation(resultPath);
  rmSync(resultPath, { force: true });

  if (executionError?.killed === true) {
    return incomplete(
      testsRan,
      "the selected test run timed out",
      "make the selected test finish within the rerun timeout",
    );
  }
  if (testsRan === 0) {
    return incomplete(
      0,
      "the selected test run did not report any parseable tests",
      "configure the test runner to report test counts",
    );
  }
  if (!confirmed) {
    return incomplete(
      testsRan,
      "the mutation response was not confirmed by the interceptor",
      "run the selected test through globalThis.fetch",
    );
  }
  if (executionError && testsFailed === 0) {
    return incomplete(
      testsRan,
      "the selected test runner failed without a parsed test assertion failure",
      "fix the test runner failure and scan again",
    );
  }
  return { kind: "completed", testsRun: testsRan, testsFailed };
}
