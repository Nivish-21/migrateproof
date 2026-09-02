import type { ReplayResult } from "../replay/runReplay.js";

export interface PatchBackendInput {
  worktreeDir: string;
  failureTrace: ReplayResult;
  instructions: string;
}

export interface PatchBackendResult {
  appliedFiles: string[];
  rawLog: string;
}

export interface PatchBackend {
  run(input: PatchBackendInput): Promise<PatchBackendResult>;
}

export function buildPrompt(failureTrace: ReplayResult): string {
  const diffJson = JSON.stringify(failureTrace.diff ?? []);
  return `The consumer code in this repository fails a business invariant after an API change. Invariant: ${failureTrace.invariant}. Observed diff: ${diffJson}. Fix the consumer client code so the invariant holds again. Do not modify test or fixture files — only the client code under test.`;
}
