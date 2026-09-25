import { describe, expect, it } from "vitest";
import {
  deriveVerdict,
  exitCodeFor,
  formatReport,
  type ScanReport,
} from "../../src/mutation/report.js";
import type { MutationOutcome } from "../../src/mutation/classify.js";

const missed: MutationOutcome = {
  endpoint: "GET https://api.example.com/orders/123",
  change: {
    endpoint: "GET /orders/{id}",
    field: "tax",
    kind: "removed",
  },
  testFiles: ["test/charge.test.ts"],
  testsRun: 3,
  testsFailed: 0,
  status: "missed",
};

const caught: MutationOutcome = {
  ...missed,
  status: "caught",
  testsFailed: 1,
};

const incomplete: MutationOutcome = {
  ...missed,
  status: "incomplete",
  testsRun: 0,
  reason: "the mutation response was not confirmed",
  nextAction: "run the selected test through globalThis.fetch",
};

function report(outcomes: MutationOutcome[]): ScanReport {
  return {
    verdict: deriveVerdict(outcomes),
    outcomes,
    mode: "changes",
    source: "https://api.example.com/changelog",
  };
}

describe("report verdicts", () => {
  it.each([
    [[caught], "protected", 0],
    [[missed], "gaps", 1],
    [[incomplete], "incomplete", 2],
    [[missed, incomplete], "gaps", 1],
  ] as const)("derives %s as %s with exit %i", (outcomes, verdict, exit) => {
    const scanReport = report(outcomes);
    expect(deriveVerdict(outcomes)).toBe(verdict);
    expect(exitCodeFor(scanReport)).toBe(exit);
  });
});

describe("formatReport", () => {
  it("renders statuses, source, and selected test files", () => {
    const output = formatReport(report([caught, missed, incomplete]));
    expect(output).toContain("Caught");
    expect(output).toContain("Missed");
    expect(output).toContain("Cannot prove");
    expect(output).toContain("test/charge.test.ts");
    expect(output).toContain("https://api.example.com/changelog");
  });

  it("keeps the complete contract in JSON", () => {
    const json = JSON.parse(JSON.stringify(report([incomplete]))) as ScanReport;
    expect(json).toMatchObject({
      verdict: "incomplete",
      outcomes: [
        {
          change: { field: "tax" },
          testFiles: ["test/charge.test.ts"],
          reason: "the mutation response was not confirmed",
          nextAction: "run the selected test through globalThis.fetch",
        },
      ],
    });
  });

  it("labels generic results as exploratory", () => {
    const output = formatReport({ ...report([caught]), mode: "generic" });
    expect(output).toMatch(/guess/i);
  });
});
