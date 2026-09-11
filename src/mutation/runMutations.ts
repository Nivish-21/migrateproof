// src/mutation/runMutations.ts
import { classifyOutcome, type MutationOutcome } from "./classify.js";
import { observe, type ObservedCall } from "./observe.js";
import { applyMutation, generateMutations } from "./operators.js";
import type { ScanReport } from "./report.js";

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

export async function runMutations(projectRoot: string): Promise<ScanReport> {
  const observed = await observe(projectRoot);

  const outcomes: MutationOutcome[] = [];
  const unprotected: string[] = [];
  const unanalyzable: { endpoint: string; reason: string }[] = [];

  if (observed.testsRan > 0 && !observed.sawAnyTraffic) {
    unanalyzable.push({
      endpoint: "(all endpoints)",
      reason:
        "tests ran but no HTTP traffic was observed — the project likely mocks above the HTTP layer",
    });
    return { outcomes, unprotected, unanalyzable };
  }

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

  return { outcomes, unprotected, unanalyzable };
}
