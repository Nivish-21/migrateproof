import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { endpointMatches } from "../changes/matchEndpoint.js";
import {
  parseChangesFile,
  type ApiChange,
  type ChangesFile,
} from "../changes/schema.js";
import { toMutation } from "../changes/toMutation.js";
import { UsageError } from "../errors.js";
import {
  classifyOutcome,
  type MutationOutcome,
  type OutcomeStatus,
} from "./classify.js";
import { detectMockLibraryUsage } from "./detectMockLibrary.js";
import { observe, type ObservedCall } from "./observe.js";
import {
  applyMutation,
  generateMutations,
  MAX_MUTATIONS_PER_RESPONSE,
  type Mutation,
} from "./operators.js";
import { deriveVerdict, type ScanReport } from "./report.js";
import { RERUN_TIMEOUT_MS, type RerunResult } from "./rerun.js";

/**
 * Hard ceilings so one scan never costs much more than running the tests by
 * hand. The rerun cap equals the per-response generic cap, so one endpoint's
 * full mutation set always fits in a single scan.
 */
export const MAX_RERUNS_PER_SCAN = MAX_MUTATIONS_PER_RESPONSE;
export const SCAN_TIME_BUDGET_MS = 5 * 60 * 1000;
const BUDGET_NEXT_ACTION =
  "list fewer changes or pass --tests with fewer files, then scan again";

export interface ScanOptions {
  /** Project-relative test files for the baseline; undefined runs the whole suite. */
  testFiles: string[] | undefined;
  onProgress: (message: string) => void;
}

export const FULL_SUITE_QUIET: ScanOptions = {
  testFiles: undefined,
  onProgress: () => {},
};

const NO_FETCH_NEXT_ACTION =
  "run a test that calls the API through globalThis.fetch";
const NO_TEST_NEXT_ACTION =
  "add or attribute a test that exercises this request";
const BASELINE_NEXT_ACTION = "fix the failing baseline tests before scanning";
const BASELINE_TIMEOUT_NEXT_ACTION =
  "pass --tests with only the test files that call this API, then scan again";
const AMBIGUOUS_RESPONSE_REASON =
  "the same request returned different response bodies or statuses";
const AMBIGUOUS_RESPONSE_NEXT_ACTION =
  "make repeated responses for this method and URL use the same status and body, then scan again";
const NOOP_CHANGE_NEXT_ACTION =
  "adjust the recorded value or API change so the requested mutation changes this field, then scan again";

export async function rerunWithMutation(
  projectRoot: string,
  call: ObservedCall,
  mutatedBody: unknown,
  timeoutMs: number,
): Promise<RerunResult> {
  const { rerun } = await import("./rerun.js");
  return rerun(projectRoot, call, mutatedBody, timeoutMs);
}

type BudgetedRerun = (
  call: ObservedCall,
  mutatedBody: unknown,
  label: string,
) => Promise<RerunResult>;

/**
 * Wraps reruns in the scan's two ceilings: a rerun count and a wall-clock
 * budget. Work past either is reported as incomplete, never dropped.
 */
function createBudgetedRerun(
  projectRoot: string,
  startedAt: number,
  plannedReruns: number,
  onProgress: (message: string) => void,
): BudgetedRerun {
  let reruns = 0;
  const total = Math.min(plannedReruns, MAX_RERUNS_PER_SCAN);
  return async (call, mutatedBody, label) => {
    const remainingMs = SCAN_TIME_BUDGET_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      return {
        kind: "incomplete",
        testsRun: 0,
        reason: `not run: the scan reached its time limit (${SCAN_TIME_BUDGET_MS / 60_000} min)`,
        nextAction: BUDGET_NEXT_ACTION,
      };
    }
    if (reruns >= MAX_RERUNS_PER_SCAN) {
      return {
        kind: "incomplete",
        testsRun: 0,
        reason: `not run: the scan reached its rerun limit (${MAX_RERUNS_PER_SCAN} per scan)`,
        nextAction: BUDGET_NEXT_ACTION,
      };
    }
    reruns += 1;
    onProgress(`rerun ${reruns}/${total}: ${label}`);
    return rerunWithMutation(
      projectRoot,
      call,
      mutatedBody,
      Math.min(RERUN_TIMEOUT_MS, remainingMs),
    );
  };
}

function sortedTestFiles(calls: ObservedCall[]): string[] {
  return [...new Set(calls.flatMap((call) => call.touchingTests))].sort();
}

function changedGenericMutations(body: unknown): Mutation[] {
  const mutations: Mutation[] = [];
  const seen = new Set<string>();

  function append(candidates: Mutation[], prefix = ""): { sawNoop: boolean } {
    let sawNoop = false;
    for (const candidate of candidates) {
      const mutation = prefix
        ? { ...candidate, fieldPath: `${prefix}.${candidate.fieldPath}` }
        : candidate;
      const unchanged = isDeepStrictEqual(body, applyMutation(body, mutation));
      const key = `${mutation.operator}:${mutation.fieldPath}`;
      if (seen.has(key)) {
        sawNoop ||= unchanged;
        continue;
      }
      seen.add(key);
      if (unchanged) {
        sawNoop = true;
        continue;
      }
      mutations.push(mutation);
      if (mutations.length === MAX_MUTATIONS_PER_RESPONSE) break;
    }
    return { sawNoop };
  }

  const initial = generateMutations(body);
  const result = append(initial);
  if (
    initial.length < MAX_MUTATIONS_PER_RESPONSE ||
    !result.sawNoop ||
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    return mutations;
  }

  function refill(value: unknown, prefix: string): void {
    if (
      mutations.length === MAX_MUTATIONS_PER_RESPONSE ||
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const candidates = generateMutations({ [key]: child });
      const scoped = append(candidates, prefix);
      if (mutations.length === MAX_MUTATIONS_PER_RESPONSE) {
        return;
      }
      if (scoped.sawNoop && typeof child === "object" && child !== null) {
        refill(child, prefix ? `${prefix}.${key}` : key);
      }
    }
  }

  refill(body, "");
  return mutations;
}

function incompleteOutcome(
  endpoint: string,
  testFiles: string[],
  reason: string,
  nextAction: string,
  change?: ApiChange,
  mutation?: MutationOutcome["mutation"],
  testsRun = 0,
): MutationOutcome {
  return {
    endpoint,
    ...(change ? { change } : {}),
    ...(mutation ? { mutation } : {}),
    testFiles,
    testsRun,
    testsFailed: 0,
    status: "incomplete",
    reason,
    nextAction,
  };
}

function makeReport(
  outcomes: MutationOutcome[],
  mode: "generic" | "changes",
  source?: string,
): ScanReport {
  return {
    verdict: deriveVerdict(outcomes),
    outcomes,
    mode,
    ...(source ? { source } : {}),
  };
}

function baselineReason(baseline: {
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  command?: string;
  timeoutMs?: number;
}): string {
  if (baseline.timedOut) {
    return `baseline test run (${baseline.command ?? "npm test"}) did not finish within its ${(baseline.timeoutMs ?? 0) / 60_000} min limit and was stopped`;
  }
  if (baseline.exitCode !== undefined) {
    return `baseline test run failed with exit code ${baseline.exitCode}`;
  }
  if (baseline.signal !== undefined) {
    return `baseline test run stopped by signal ${baseline.signal}`;
  }
  return "baseline test run failed";
}

function aggregateChangeOutcome(
  change: ApiChange,
  candidates: MutationOutcome[],
  testFiles: string[],
): MutationOutcome {
  const precedence: Record<OutcomeStatus, number> = {
    caught: 0,
    incomplete: 1,
    missed: 2,
  };
  const representative = candidates.reduce((current, candidate) =>
    precedence[candidate.status] > precedence[current.status]
      ? candidate
      : current,
  );
  return {
    endpoint: representative.endpoint,
    change,
    testFiles,
    testsRun: candidates.reduce(
      (sum, candidate) => sum + candidate.testsRun,
      0,
    ),
    testsFailed: candidates.reduce(
      (sum, candidate) => sum + candidate.testsFailed,
      0,
    ),
    status: representative.status,
    ...(representative.reason ? { reason: representative.reason } : {}),
    ...(representative.nextAction
      ? { nextAction: representative.nextAction }
      : {}),
  };
}

function loadChangesFile(changesPath: string): ChangesFile {
  let rawChanges: string;
  try {
    rawChanges = readFileSync(changesPath, "utf-8");
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new UsageError(`changes file not found: ${changesPath}`);
    }
    throw error;
  }
  return parseChangesFile(rawChanges, changesPath);
}

export async function runMutations(
  projectRoot: string,
  changesPath?: string,
  options: ScanOptions = FULL_SUITE_QUIET,
): Promise<ScanReport> {
  const startedAt = Date.now();
  const changesFile = changesPath ? loadChangesFile(changesPath) : undefined;
  const { testFiles, onProgress } = options;
  onProgress(
    testFiles
      ? `baseline: ${testFiles.length} test file${testFiles.length === 1 ? "" : "s"} (${testFiles.join(", ")})`
      : "baseline: full test suite",
  );
  const observed = await observe(projectRoot, testFiles);
  const mode = changesFile ? "changes" : "generic";
  const report = await mutateObserved(
    projectRoot,
    observed,
    changesFile,
    mode,
    startedAt,
    onProgress,
  );
  onProgress(`done in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  return report;
}

async function mutateObserved(
  projectRoot: string,
  observed: Awaited<ReturnType<typeof observe>>,
  changesFile: ChangesFile | undefined,
  mode: "generic" | "changes",
  startedAt: number,
  onProgress: (message: string) => void,
): Promise<ScanReport> {
  if (!observed.baseline.passed) {
    const reason = baselineReason(observed.baseline);
    const nextAction = observed.baseline.timedOut
      ? BASELINE_TIMEOUT_NEXT_ACTION
      : BASELINE_NEXT_ACTION;
    const outcomes = changesFile
      ? changesFile.changes.map((change) =>
          incompleteOutcome(change.endpoint, [], reason, nextAction, change),
        )
      : [incompleteOutcome("(all endpoints)", [], reason, nextAction)];
    return makeReport(outcomes, mode, changesFile?.source);
  }

  if (!observed.sawAnyTraffic) {
    const mockHint = detectMockLibraryUsage(projectRoot);
    const reason = mockHint
      ? `tests ran but no HTTP traffic was observed — ${mockHint.evidence}, which MigrateProof's interceptor cannot see`
      : "tests ran but no HTTP traffic was observed";
    const outcomes = changesFile
      ? changesFile.changes.map((change) =>
          incompleteOutcome(
            change.endpoint,
            [],
            reason,
            NO_FETCH_NEXT_ACTION,
            change,
          ),
        )
      : [
          incompleteOutcome(
            "(all endpoints)",
            [],
            reason,
            NO_FETCH_NEXT_ACTION,
          ),
        ];
    return makeReport(outcomes, mode, changesFile?.source);
  }

  if (!changesFile) {
    const budgetedRerun = createBudgetedRerun(
      projectRoot,
      startedAt,
      observed.calls.reduce(
        (sum, call) => sum + changedGenericMutations(call.body).length,
        0,
      ),
      onProgress,
    );
    const outcomes: MutationOutcome[] = [];
    for (const call of observed.calls) {
      const endpoint = `${call.method} ${call.url}`;
      for (const mutation of changedGenericMutations(call.body)) {
        const mutatedBody = applyMutation(call.body, mutation);
        if (isDeepStrictEqual(call.body, mutatedBody)) continue;

        if (call.responseAmbiguous) {
          outcomes.push(
            incompleteOutcome(
              endpoint,
              sortedTestFiles([call]),
              AMBIGUOUS_RESPONSE_REASON,
              AMBIGUOUS_RESPONSE_NEXT_ACTION,
              undefined,
              mutation,
            ),
          );
          continue;
        }
        if (call.touchingTests.length === 0) {
          outcomes.push(
            incompleteOutcome(
              endpoint,
              [],
              "no test could be attributed to this request",
              NO_TEST_NEXT_ACTION,
              undefined,
              mutation,
            ),
          );
          continue;
        }
        const rerun = await budgetedRerun(
          call,
          mutatedBody,
          `${endpoint} ${mutation.operator} ${mutation.fieldPath}`,
        );
        if (rerun.kind === "incomplete") {
          outcomes.push(
            incompleteOutcome(
              endpoint,
              sortedTestFiles([call]),
              rerun.reason,
              rerun.nextAction,
              undefined,
              mutation,
              rerun.testsRun,
            ),
          );
          continue;
        }
        outcomes.push({
          endpoint,
          mutation,
          testFiles: sortedTestFiles([call]),
          testsRun: rerun.testsRun,
          testsFailed: rerun.testsFailed,
          status: classifyOutcome(rerun.testsRun, rerun.testsFailed),
        });
      }
    }
    return makeReport(outcomes, "generic");
  }

  const budgetedRerun = createBudgetedRerun(
    projectRoot,
    startedAt,
    changesFile.changes.reduce(
      (sum, change) =>
        sum +
        observed.calls.filter((call) =>
          endpointMatches(call, changesFile.api, change.endpoint),
        ).length,
      0,
    ),
    onProgress,
  );
  const outcomes: MutationOutcome[] = [];
  for (const change of changesFile.changes) {
    const matchingCalls = observed.calls.filter((call) =>
      endpointMatches(call, changesFile.api, change.endpoint),
    );
    const testFiles = sortedTestFiles(matchingCalls);

    if (matchingCalls.length === 0) {
      outcomes.push(
        incompleteOutcome(
          change.endpoint,
          [],
          "endpoint not called by this codebase",
          NO_FETCH_NEXT_ACTION,
          change,
        ),
      );
      continue;
    }

    const candidates: MutationOutcome[] = [];
    for (const call of matchingCalls) {
      const endpoint = `${call.method} ${call.url}`;
      if (call.responseAmbiguous) {
        candidates.push(
          incompleteOutcome(
            endpoint,
            sortedTestFiles([call]),
            AMBIGUOUS_RESPONSE_REASON,
            AMBIGUOUS_RESPONSE_NEXT_ACTION,
            change,
          ),
        );
        continue;
      }

      const mutation = toMutation(change, call.body);
      if (!mutation.ok) {
        candidates.push(
          incompleteOutcome(
            endpoint,
            sortedTestFiles([call]),
            mutation.reason,
            "record a response containing this field, then scan again",
            change,
          ),
        );
        continue;
      }

      const mutatedBody = applyMutation(call.body, mutation.mutation);
      if (isDeepStrictEqual(call.body, mutatedBody)) {
        candidates.push(
          incompleteOutcome(
            endpoint,
            sortedTestFiles([call]),
            "the requested mutation does not change the recorded response",
            NOOP_CHANGE_NEXT_ACTION,
            change,
            mutation.mutation,
          ),
        );
        continue;
      }

      if (call.touchingTests.length === 0) {
        candidates.push(
          incompleteOutcome(
            endpoint,
            [],
            "no test could be attributed to this request",
            NO_TEST_NEXT_ACTION,
            change,
          ),
        );
        continue;
      }

      const rerun = await budgetedRerun(
        call,
        mutatedBody,
        `${endpoint} ${change.field}`,
      );
      if (rerun.kind === "incomplete") {
        candidates.push(
          incompleteOutcome(
            endpoint,
            sortedTestFiles([call]),
            rerun.reason,
            rerun.nextAction,
            change,
            mutation.mutation,
            rerun.testsRun,
          ),
        );
        continue;
      }
      candidates.push({
        endpoint,
        change,
        mutation: mutation.mutation,
        testFiles: sortedTestFiles([call]),
        testsRun: rerun.testsRun,
        testsFailed: rerun.testsFailed,
        status: classifyOutcome(rerun.testsRun, rerun.testsFailed),
      });
    }
    outcomes.push(aggregateChangeOutcome(change, candidates, testFiles));
  }

  return makeReport(outcomes, "changes", changesFile.source);
}
