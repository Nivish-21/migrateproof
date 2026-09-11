// src/mutation/observe.ts
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { UsageError } from "../errors.js";

const execFileAsync = promisify(execFile);

const OBSERVE_TIMEOUT_MS = 10 * 60 * 1000;

export interface ObservedCall {
  method: string;
  url: string;
  status: number;
  body: unknown;
  touchingTests: string[];
}

export interface ObserveResult {
  calls: ObservedCall[];
  testsRan: number;
  failingTests: string[];
  sawAnyTraffic: boolean;
}

export function resolveTestCommand(packageJsonPath: string): string[] {
  if (!existsSync(packageJsonPath)) {
    throw new UsageError(
      `no package.json found at ${packageJsonPath} — run this from a Node project's root`,
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const scripts =
    typeof parsed === "object" && parsed !== null && "scripts" in parsed
      ? (parsed as { scripts?: Record<string, string> }).scripts
      : undefined;
  if (!scripts?.test) {
    throw new UsageError(
      `package.json has no "test" script — MigrateProof needs one to observe your suite`,
    );
  }
  // argv array only, never a shell string — see AGENTS.md.
  return ["npm", "test", "--silent"];
}

interface RawRecordedCall {
  method: string;
  url: string;
  status: number;
  body: unknown;
  touchingTest?: string;
}

function parseTestCounts(output: string): {
  testsRan: number;
  failingTests: string[];
} {
  let testsRan = 0;
  const failingTests: string[] = [];

  // Match Vitest format: Tests  X passed, Y failed (Z)
  const vitestPassed = output.match(/(\d+)\s+passed/i);
  const vitestFailed = output.match(/(\d+)\s+failed/i);

  if (vitestPassed || vitestFailed) {
    const passed = vitestPassed?.[1] ? parseInt(vitestPassed[1], 10) : 0;
    const failed = vitestFailed?.[1] ? parseInt(vitestFailed[1], 10) : 0;
    testsRan = passed + failed;
  }

  // Also match Jest format: Tests: X passed, Y failed, Z total
  const jestTotal = output.match(/Tests:\s+.*(?:(\d+)\s+total)/i);
  if (jestTotal?.[1]) {
    testsRan = Math.max(testsRan, parseInt(jestTotal[1], 10));
  }

  return { testsRan, failingTests };
}

export async function observe(projectRoot: string): Promise<ObserveResult> {
  const argv = resolveTestCommand(join(projectRoot, "package.json"));
  const [command, ...args] = argv;
  if (command === undefined) {
    throw new UsageError("could not resolve a test command");
  }

  const recordingPath = join(
    projectRoot,
    "node_modules",
    ".migrateproof-recording.json",
  );
  const jsonlPath = `${recordingPath}.jsonl`;
  mkdirSync(dirname(recordingPath), { recursive: true });
  if (existsSync(jsonlPath)) {
    rmSync(jsonlPath, { force: true });
  }

  // Resolve setupModule. Handle both .ts (development via tsx) and .js (compiled dist).
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const tsSetup = join(thisDir, "observeSetup.ts");
  const jsSetup = join(thisDir, "observeSetup.js");
  const setupModule = existsSync(tsSetup) ? tsSetup : jsSetup;

  let combinedOutput = "";

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: projectRoot,
      timeout: OBSERVE_TIMEOUT_MS,
      env: {
        ...process.env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --import ${setupModule}`.trim(),
        MIGRATEPROOF_RECORDING_PATH: recordingPath,
      },
    });
    combinedOutput = `${stdout}\n${stderr}`;
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
      const execError = error as { stdout?: string; stderr?: string };
      combinedOutput = `${execError.stdout ?? ""}\n${execError.stderr ?? ""}`;
    }
  }

  if (!existsSync(jsonlPath)) {
    const { testsRan, failingTests } = parseTestCounts(combinedOutput);
    return {
      calls: [],
      testsRan:
        testsRan > 0 ? testsRan : combinedOutput.trim().length > 0 ? 1 : 0,
      failingTests,
      sawAnyTraffic: false,
    };
  }

  const content = readFileSync(jsonlPath, "utf-8");
  rmSync(jsonlPath, { force: true });

  const rawLines = content.split("\n").filter((l) => l.trim().length > 0);
  const byKey = new Map<string, ObservedCall>();

  for (const line of rawLines) {
    try {
      const parsed = JSON.parse(line) as RawRecordedCall;
      const key = `${parsed.method} ${parsed.url}`;
      const existing = byKey.get(key);
      if (existing) {
        if (
          parsed.touchingTest &&
          !existing.touchingTests.includes(parsed.touchingTest)
        ) {
          existing.touchingTests.push(parsed.touchingTest);
        }
      } else {
        byKey.set(key, {
          method: parsed.method,
          url: parsed.url,
          status: parsed.status,
          body: parsed.body,
          touchingTests: parsed.touchingTest ? [parsed.touchingTest] : [],
        });
      }
    } catch {
      // ignore malformed line
    }
  }

  const calls = Array.from(byKey.values());
  const { testsRan: parsedRan, failingTests } = parseTestCounts(combinedOutput);
  const totalTouching = new Set(calls.flatMap((c) => c.touchingTests)).size;
  const testsRan = Math.max(parsedRan, totalTouching, 1);

  return {
    calls,
    testsRan,
    failingTests,
    sawAnyTraffic: calls.length > 0,
  };
}
