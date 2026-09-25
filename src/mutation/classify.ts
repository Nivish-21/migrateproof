import type { ApiChange } from "../changes/schema.js";
import type { Mutation } from "./operators.js";

export type OutcomeStatus = "caught" | "missed" | "incomplete";

export interface MutationOutcome {
  endpoint: string;
  change?: ApiChange;
  mutation?: Mutation;
  testFiles: string[];
  testsRun: number;
  testsFailed: number;
  status: OutcomeStatus;
  reason?: string;
  nextAction?: string;
}

export function classifyOutcome(
  testsRun: number,
  testsFailed: number,
): OutcomeStatus {
  if (testsRun === 0) return "incomplete";
  return testsFailed > 0 ? "caught" : "missed";
}

const STATUS_ORDER: Record<OutcomeStatus, number> = {
  missed: 0,
  incomplete: 1,
  caught: 2,
};

export function rankOutcomes(outcomes: MutationOutcome[]): MutationOutcome[] {
  return [...outcomes].sort((a, b) => {
    const statusOrder = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return statusOrder !== 0 ? statusOrder : b.testsRun - a.testsRun;
  });
}
