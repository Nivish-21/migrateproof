import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { UsageError } from "../errors.js";
import { resolveTestCommand, type ObservedCall } from "./observe.js";

const execFileAsync = promisify(execFile);
const RERUN_TIMEOUT_MS = 60 * 1000;
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g",
);

export type RerunResult =
  | { kind: "completed"; testsRun: number; testsFailed: number }
  | {
      kind: "incomplete";
      testsRun: number;
      reason: string;
      nextAction: string;
    };

export function parseCounts(output: string): {
  testsRan: number;
  testsFailed: number;
} {
  const cleanOutput = output.replace(ANSI_ESCAPE_SEQUENCE, "");
  const lines = cleanOutput.split(/\r?\n/).map((line) => line.trim());
  const nodeCounts = new Map<string, number>();

  for (const line of lines) {
    const match = line.match(/^(?:ℹ\s*|#\s*)(tests|pass|fail)\s+(\d+)$/i);
    if (match?.[1] && match[2]) {
      nodeCounts.set(match[1].toLowerCase(), Number(match[2]));
    }
  }

  const nodeTotal = nodeCounts.get("tests");
  if (nodeTotal !== undefined) {
    const passed = nodeCounts.get("pass");
    const failed = nodeCounts.get("fail");
    if (
      passed === undefined ||
      failed === undefined ||
      passed + failed !== nodeTotal
    ) {
      return { testsRan: 0, testsFailed: 0 };
    }
    return { testsRan: nodeTotal, testsFailed: failed };
  }

  for (const line of lines) {
    const vitest = line.match(
      /^Tests\s+(?:(\d+)\s+passed(?:(?:,\s*|\s*\|\s*)(\d+)\s+failed)?|(\d+)\s+failed(?:(?:,\s*|\s*\|\s*)(\d+)\s+passed)?)\s+\((\d+)\)$/i,
    );
    if (vitest?.[5]) {
      const passed = Number(vitest[1] ?? vitest[4] ?? 0);
      const failed = Number(vitest[2] ?? vitest[3] ?? 0);
      const total = Number(vitest[5]);
      return passed + failed === total
        ? { testsRan: total, testsFailed: failed }
        : { testsRan: 0, testsFailed: 0 };
    }

    const jest = line.match(
      /^Tests:\s*(?:(\d+)\s+failed)?(?:,\s*)?(?:(\d+)\s+passed)?(?:,\s*)?(\d+)\s+total$/i,
    );
    if (jest?.[3] && (jest[1] || jest[2])) {
      const failed = Number(jest[1] ?? 0);
      const passed = Number(jest[2] ?? 0);
      const total = Number(jest[3]);
      return passed + failed <= total
        ? { testsRan: passed + failed, testsFailed: failed }
        : { testsRan: 0, testsFailed: 0 };
    }
  }

  return { testsRan: 0, testsFailed: 0 };
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
          `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(setupModule).href}`.trim(),
        MIGRATEPROOF_MUTATION_CONFIG: mutationConfig,
        MIGRATEPROOF_MUTATION_RESULT_PATH: resultPath,
        MIGRATEPROOF_OBSERVING: "1",
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
      typeof executionError.signal === "string"
        ? `the selected test run timed out after signal ${executionError.signal}`
        : "the selected test run timed out",
      "make the selected test finish within the rerun timeout",
    );
  }
  if (typeof executionError?.signal === "string") {
    return incomplete(
      testsRan,
      `the selected test run stopped by signal ${executionError.signal}`,
      "fix the interrupted test run and scan again",
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
  if (
    (executionError === undefined && testsFailed > 0) ||
    (executionError !== undefined &&
      testsFailed > 0 &&
      executionError.code !== 1)
  ) {
    return incomplete(
      testsRan,
      "the test runner exit status contradicts its reported test failures",
      "fix the test runner and scan again",
    );
  }
  return { kind: "completed", testsRun: testsRan, testsFailed };
}
