// test/mutation/report.test.ts
import { describe, expect, it } from "vitest";
import {
  formatReport,
  hasGaps,
  type ScanReport,
} from "../../src/mutation/report.js";
import type { MutationOutcome } from "../../src/mutation/classify.js";

const gap: MutationOutcome = {
  endpoint: "GET https://api.example.com/orders/123",
  mutation: {
    operator: "type-flip",
    fieldPath: "tax",
    before: 250,
    after: "250",
    description: 'tax: 250 -> "250" (type-flip)',
  },
  testsRun: 3,
  testsFailed: 0,
  classification: "gap",
};

const caught: MutationOutcome = {
  ...gap,
  classification: "caught",
  testsFailed: 1,
};

describe("formatReport", () => {
  it("names the endpoint, the field, and the test count for a gap", () => {
    const report: ScanReport = {
      outcomes: [gap],
      unprotected: [],
      unanalyzable: [],
    };
    const output = formatReport(report);
    expect(output).toContain("tax");
    expect(output).toContain("orders/123");
    expect(output).toContain("3");
  });

  it("reports a clean result when there are no gaps", () => {
    const output = formatReport({
      outcomes: [caught],
      unprotected: [],
      unanalyzable: [],
    });
    expect(output).toContain("no gaps");
  });

  it("lists unprotected endpoints separately from gaps", () => {
    const output = formatReport({
      outcomes: [],
      unprotected: ["GET /health"],
      unanalyzable: [],
    });
    expect(output).toContain("/health");
    expect(output).toContain("no tests");
  });

  // Two of the six real projects scanned on 2026-09-13 mock above the HTTP
  // layer, so nothing was analysable. The report still led with the green
  // "no gaps" line, which reads as a pass when in fact no mutation ever ran.
  it("does not claim a pass when no mutation was run at all", () => {
    const output = formatReport({
      outcomes: [],
      unprotected: [],
      unanalyzable: [
        { endpoint: "(all endpoints)", reason: "no HTTP traffic observed" },
      ],
    });
    expect(output).not.toContain("no gaps");
    expect(output).toContain("nothing was analysed");
  });

  it("does not claim a pass when every endpoint was unprotected", () => {
    const output = formatReport({
      outcomes: [],
      unprotected: ["GET /health"],
      unanalyzable: [],
    });
    expect(output).not.toContain("no gaps");
  });

  it("lists unanalyzable endpoints with their stated reason", () => {
    const output = formatReport({
      outcomes: [],
      unprotected: [],
      unanalyzable: [{ endpoint: "GET /orders", reason: "mocked above HTTP" }],
    });
    expect(output).toContain("mocked above HTTP");
  });
});

describe("hasGaps", () => {
  it("is true when any outcome is a gap", () => {
    expect(
      hasGaps({ outcomes: [gap], unprotected: [], unanalyzable: [] }),
    ).toBe(true);
  });

  it("is false when every outcome was caught", () => {
    expect(
      hasGaps({ outcomes: [caught], unprotected: [], unanalyzable: [] }),
    ).toBe(false);
  });
});
