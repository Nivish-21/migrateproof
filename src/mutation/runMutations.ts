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
import type { RerunResult } from "./rerun.js";

const NO_FETCH_NEXT_ACTION =
  "run a test that calls the API through globalThis.fetch";
const NO_TEST_NEXT_ACTION =
  "add or attribute a test that exercises this request";
const BASELINE_NEXT_ACTION = "fix the failing baseline tests before scanning";
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
): Promise<RerunResult> {
  const { rerun } = await import("./rerun.js");
  return rerun(projectRoot, call, mutatedBody);
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
}): string {
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
): Promise<ScanReport> {
  const changesFile = changesPath ? loadChangesFile(changesPath) : undefined;
  const observed = await observe(projectRoot);
  const mode = changesFile ? "changes" : "generic";

  if (!observed.baseline.passed) {
    const reason = baselineReason(observed.baseline);
    const outcomes = changesFile
      ? changesFile.changes.map((change) =>
          incompleteOutcome(
            change.endpoint,
            [],
            reason,
            BASELINE_NEXT_ACTION,
            change,
          ),
        )
      : [
          incompleteOutcome(
            "(all endpoints)",
            [],
            reason,
            BASELINE_NEXT_ACTION,
          ),
        ];
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
        const rerun = await rerunWithMutation(projectRoot, call, mutatedBody);
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

      const rerun = await rerunWithMutation(projectRoot, call, mutatedBody);
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
