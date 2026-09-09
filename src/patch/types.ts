import type { ReplayResult } from "../replay/runReplay.js";
import type { Verdict } from "../semantic-engine/types.js";

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

export function buildPrompt(
  failureTrace: ReplayResult,
  verdicts?: Map<string, Verdict>,
): string {
  const diffEntries = failureTrace.diff ?? [];
  const diffSection = verdicts
    ? diffEntries
        .map((entry) => {
          const verdict = verdicts.get(entry.field);
          const base = `${entry.field}: ${JSON.stringify(entry.from)} → ${JSON.stringify(entry.to)}`;
          return verdict && verdict.classification !== "unknown"
            ? `${base} (${verdict.explanation})`
            : base;
        })
        .join("; ")
    : JSON.stringify(diffEntries);

  return (
    `The consumer code in this repository fails a business invariant after an API change. ` +
    `Invariant: ${failureTrace.invariant}. Observed diff: ${diffSection}. ` +
    `Fix the consumer client code so the invariant holds again. ` +
    `Do not modify test or fixture files — only the client code under test.`
  );
}
