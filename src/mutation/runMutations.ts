// src/mutation/runMutations.ts
import { readFileSync } from "node:fs";
import { endpointMatches } from "../changes/matchEndpoint.js";
import { parseChangesFile, type ChangesFile } from "../changes/schema.js";
import { toMutation } from "../changes/toMutation.js";
import { UsageError } from "../errors.js";
import { classifyOutcome, type MutationOutcome } from "./classify.js";
import { detectMockLibraryUsage } from "./detectMockLibrary.js";
import { observe, type ObservedCall } from "./observe.js";
import { applyMutation, generateMutations } from "./operators.js";
import type { ScanReport, UnmatchedChange } from "./report.js";

export type { UnmatchedChange };

export interface RerunResult {
  testsRun: number;
  testsFailed: number;
}

// Re-runs only the tests that touched this endpoint, serving the mutated
// response. The serving mechanism is whatever Task 36's spike confirmed.
export async function rerunWithMutation(
  projectRoot: string,
  call: ObservedCall,
  mutatedBody: unknown,
): Promise<RerunResult> {
  const { rerun } = await import("./rerun.js");
  return rerun(projectRoot, call, mutatedBody);
}

export async function runMutations(
  projectRoot: string,
  changesPath?: string,
): Promise<ScanReport> {
  let changesFile: ChangesFile | undefined;
  if (changesPath !== undefined) {
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
    changesFile = parseChangesFile(rawChanges, changesPath);
  }

  const observed = await observe(projectRoot);

  const outcomes: MutationOutcome[] = [];
  const unprotected: string[] = [];
  const unanalyzable: { endpoint: string; reason: string }[] = [];

  if (observed.testsRan > 0 && !observed.sawAnyTraffic) {
    const mockHint = detectMockLibraryUsage(projectRoot);
    unanalyzable.push({
      endpoint: "(all endpoints)",
      reason: mockHint
        ? `tests ran but no HTTP traffic was observed — ${mockHint.evidence}, which MigrateProof's interceptor cannot see`
        : "tests ran but no HTTP traffic was observed — the project likely mocks above the HTTP layer",
    });
    return {
      outcomes,
      unprotected,
      unanalyzable,
      ...(changesFile !== undefined
        ? {
            unmatched: [],
            mode: "changes" as const,
            ...(changesFile.source ? { source: changesFile.source } : {}),
          }
        : { mode: "generic" as const }),
    };
  }

  if (changesFile === undefined) {
    for (const call of observed.calls) {
      const endpoint = `${call.method} ${call.url}`;
      if (call.touchingTests.length === 0) {
        unprotected.push(endpoint);
        continue;
      }
      for (const mutation of generateMutations(call.body)) {
        const mutatedBody = applyMutation(call.body, mutation);
        const { testsRun, testsFailed } = await rerunWithMutation(
          projectRoot,
          call,
          mutatedBody,
        );
        outcomes.push({
          endpoint,
          mutation,
          testsRun,
          testsFailed,
          classification: classifyOutcome(testsRun, testsFailed),
        });
      }
    }

    return { outcomes, unprotected, unanalyzable, mode: "generic" };
  }

  const unmatched: UnmatchedChange[] = [];

  for (const change of changesFile.changes) {
    const matchingCalls = observed.calls.filter((call) =>
      endpointMatches(call, changesFile!.api, change.endpoint),
    );

    if (matchingCalls.length === 0) {
      unmatched.push({
        endpoint: change.endpoint,
        field: change.field,
        reason: "endpoint not called by this codebase",
      });
      continue;
    }

    for (const call of matchingCalls) {
      const endpoint = `${call.method} ${call.url}`;
      if (call.touchingTests.length === 0) {
        if (!unprotected.includes(endpoint)) {
          unprotected.push(endpoint);
        }
        continue;
      }

      const mutResult = toMutation(change, call.body);
      if (!mutResult.ok) {
        unmatched.push({
          endpoint: change.endpoint,
          field: change.field,
          reason: mutResult.reason,
        });
        continue;
      }

      const mutatedBody = applyMutation(call.body, mutResult.mutation);
      const { testsRun, testsFailed } = await rerunWithMutation(
        projectRoot,
        call,
        mutatedBody,
      );
      outcomes.push({
        endpoint,
        mutation: mutResult.mutation,
        testsRun,
        testsFailed,
        classification: classifyOutcome(testsRun, testsFailed),
      });
    }
  }

  return {
    outcomes,
    unprotected,
    unanalyzable,
    unmatched,
    mode: "changes",
    ...(changesFile.source ? { source: changesFile.source } : {}),
  };
}
