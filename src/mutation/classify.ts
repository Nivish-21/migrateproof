// src/mutation/classify.ts
import type { Mutation } from "./operators.js";

export type Classification = "caught" | "gap";

export type EndpointStatus = "analyzed" | "unprotected" | "unanalyzable";

export interface MutationOutcome {
  endpoint: string;
  mutation: Mutation;
  testsRun: number;
  testsFailed: number;
  classification: Classification;
}

export function classifyOutcome(
  testsRun: number,
  testsFailed: number,
): Classification {
  return testsFailed > 0 ? "caught" : "gap";
}

export function rankOutcomes(outcomes: MutationOutcome[]): MutationOutcome[] {
  return [...outcomes].sort((a, b) => {
    if (a.classification !== b.classification) {
      return a.classification === "gap" ? -1 : 1;
    }
    return b.testsRun - a.testsRun;
  });
}
