// src/mutation/report.ts
import { rankOutcomes, type MutationOutcome } from "./classify.js";

export interface ScanReport {
  outcomes: MutationOutcome[];
  unprotected: string[];
  unanalyzable: { endpoint: string; reason: string }[];
}

export function hasGaps(report: ScanReport): boolean {
  return report.outcomes.some((o) => o.classification === "gap");
}

export function formatReport(report: ScanReport): string {
  const lines: string[] = [];
  const gaps = rankOutcomes(report.outcomes).filter(
    (o) => o.classification === "gap",
  );

  if (report.outcomes.length === 0) {
    // A suite that mocks above the HTTP layer produces no outcomes at all.
    // Reporting that as "no gaps" reads as a pass when nothing was ever
    // checked, which is the one result a user must not misread. Two of the
    // six real projects scanned on 2026-09-13 landed here.
    lines.push("• nothing was analysed — no mutation ran against any endpoint");
    lines.push("");
  } else if (gaps.length === 0) {
    lines.push("✓ no gaps — every mutation was caught by your test suite");
  } else {
    lines.push(`✗ ${gaps.length} gap(s) your test suite would not catch:`);
    lines.push("");
    const byEndpoint = new Map<string, MutationOutcome[]>();
    for (const gap of gaps) {
      const existing = byEndpoint.get(gap.endpoint) ?? [];
      existing.push(gap);
      byEndpoint.set(gap.endpoint, existing);
    }
    for (const [endpoint, endpointGaps] of byEndpoint) {
      lines.push(`  ${endpoint}`);
      for (const gap of endpointGaps) {
        lines.push(
          `    ${gap.mutation.description} — ${gap.testsRun} test(s) ran, none failed`,
        );
      }
      lines.push("");
    }
  }

  if (report.unprotected.length > 0) {
    lines.push(
      `${report.unprotected.length} endpoint(s) have no tests at all:`,
    );
    for (const endpoint of report.unprotected) {
      lines.push(`  ${endpoint}`);
    }
    lines.push("");
  }

  if (report.unanalyzable.length > 0) {
    lines.push(
      `${report.unanalyzable.length} endpoint(s) could not be analyzed:`,
    );
    for (const entry of report.unanalyzable) {
      lines.push(`  ${entry.endpoint} — ${entry.reason}`);
    }
  }

  return lines.join("\n");
}
