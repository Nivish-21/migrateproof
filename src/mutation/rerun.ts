// src/mutation/rerun.ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveTestCommand, type ObservedCall } from "./observe.js";
import type { RerunResult } from "./runMutations.js";
import { UsageError } from "../errors.js";

const execFileAsync = promisify(execFile);

const RERUN_TIMEOUT_MS = 60 * 1000;

function matchCount(output: string, pattern: RegExp): number {
  const match = output.match(pattern);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}

/**
 * Reads how many tests ran and how many failed out of a test runner's output.
 *
 * Three reporters are recognised. Vitest and jest both spell the words out
 * ("3 passed", "1 failed", "Tests: 4 total"); node's built-in runner does not,
 * printing "ℹ tests 40 / ℹ pass 40 / ℹ fail 0" instead. Without the node
 * patterns a `node --test` suite parsed to nothing and the caller substituted
 * a placeholder, so a report claimed one test had run when forty had.
 *
 * The two families of pattern cannot collide: "pass" followed by whitespace
 * never occurs inside "passed", and vitest's "Tests:" is separated by a colon
 * rather than the whitespace the node pattern requires.
 */
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

  // Without a test subset this would run the target's entire suite, once per
  // mutation. That is dozens of full suite runs for a single endpoint, which
  // is a resource bomb on a stranger's machine, not a slow scan. The caller
  // (runMutations) already routes unattributed endpoints away from here;
  // this refuses outright in case another caller ever forgets.
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

  const mutationConfig = JSON.stringify({
    method: call.method,
    url: call.url,
    mutatedBody,
  });

  let output = "";
  let didThrow = false;

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: projectRoot,
      timeout: RERUN_TIMEOUT_MS,
      env: {
        ...process.env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --import ${setupModule}`.trim(),
        MIGRATEPROOF_MUTATION_CONFIG: mutationConfig,
      },
    });
    output = `${stdout}\n${stderr}`;
  } catch (error: unknown) {
    didThrow = true;
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
      const execErr = error as { stdout?: string; stderr?: string };
      output = `${execErr.stdout ?? ""}\n${execErr.stderr ?? ""}`;
    }
  }

  const { testsRan: parsedRan, testsFailed: parsedFailed } =
    parseCounts(output);

  if (didThrow) {
    const testsFailed = Math.max(parsedFailed, 1);
    const testsRun = Math.max(
      parsedRan,
      testsFailed,
      call.touchingTests.length,
    );
    return { testsRun, testsFailed };
  }

  // Only fall back to the number of attributed tests when the runner's output
  // gave us nothing to read. Taking the larger of the two unconditionally
  // overstated the count for any runner whose format we parse correctly.
  const testsRun =
    parsedRan > 0 ? parsedRan : Math.max(1, call.touchingTests.length);
  return { testsRun, testsFailed: parsedFailed };
}
