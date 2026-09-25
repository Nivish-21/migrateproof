import { rankOutcomes, type MutationOutcome } from "./classify.js";

export type Verdict = "protected" | "gaps" | "incomplete";

export interface ScanReport {
  verdict: Verdict;
  outcomes: MutationOutcome[];
  mode: "generic" | "changes";
  source?: string;
}

export function deriveVerdict(outcomes: MutationOutcome[]): Verdict {
  if (outcomes.some((outcome) => outcome.status === "missed")) return "gaps";
  if (outcomes.some((outcome) => outcome.status === "incomplete")) {
    return "incomplete";
  }
  return outcomes.length > 0 ? "protected" : "incomplete";
}

export function exitCodeFor(report: ScanReport): 0 | 1 | 2 {
  if (report.verdict === "protected") return 0;
  return report.verdict === "gaps" ? 1 : 2;
}

function outcomeDescription(outcome: MutationOutcome): string {
  if (outcome.mutation) return outcome.mutation.description;
  if (outcome.change) {
    return `${outcome.change.endpoint} (${outcome.change.field})`;
  }
  return outcome.endpoint;
}

export function formatReport(report: ScanReport): string {
  const lines: string[] = [];

  if (report.mode === "generic") {
    lines.push(
      "these mutations are guesses — no changes file was supplied, so the tool",
      "invented plausible failures rather than testing real ones",
      "",
    );
  }
  if (report.source) lines.push(`Source: ${report.source}`, "");

  if (report.verdict === "protected") {
    lines.push("✓ Protected — every confirmed mutation was caught.");
  } else if (report.verdict === "gaps") {
    lines.push("✗ Gaps — at least one confirmed mutation was missed.");
  } else {
    lines.push(
      "? Cannot prove — one or more requested mutations were incomplete.",
    );
  }

  for (const outcome of rankOutcomes(report.outcomes)) {
    const label =
      outcome.status === "caught"
        ? "Caught"
        : outcome.status === "missed"
          ? "Missed"
          : "Cannot prove";
    lines.push("", `${label}: ${outcomeDescription(outcome)}`);
    lines.push(`  ${outcome.endpoint}`);
    if (outcome.testFiles.length > 0) {
      lines.push(`  tests: ${outcome.testFiles.join(", ")}`);
    }
    if (outcome.status !== "incomplete") {
      lines.push(
        `  ${outcome.testsRun} test(s) ran, ${outcome.testsFailed} failed`,
      );
    }
    if (outcome.reason) lines.push(`  reason: ${outcome.reason}`);
    if (outcome.nextAction) lines.push(`  next: ${outcome.nextAction}`);
  }

  return lines.join("\n");
}
