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

function parseCounts(output: string): {
  testsRan: number;
  testsFailed: number;
} {
  let testsRan = 0;
  let testsFailed = 0;

  const failedMatch = output.match(/(\d+)\s+failed/i);
  if (failedMatch?.[1]) {
    testsFailed = parseInt(failedMatch[1], 10);
  }

  const passedMatch = output.match(/(\d+)\s+passed/i);
  let testsPassed = 0;
  if (passedMatch?.[1]) {
    testsPassed = parseInt(passedMatch[1], 10);
  }

  testsRan = testsFailed + testsPassed;

  const jestTotal = output.match(/Tests:\s+.*(?:(\d+)\s+total)/i);
  if (jestTotal?.[1]) {
    testsRan = Math.max(testsRan, parseInt(jestTotal[1], 10));
  }

  return { testsRan, testsFailed };
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

  const args = [...baseArgs];
  if (call.touchingTests.length > 0) {
    args.push("--", ...call.touchingTests);
  }

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

  const testsFailed = parsedFailed;
  const testsRun = Math.max(parsedRan, 1, call.touchingTests.length);
  return { testsRun, testsFailed };
}
