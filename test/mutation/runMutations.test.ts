import { afterEach, describe, expect, it, vi } from "vitest";
import { runMutations } from "../../src/mutation/runMutations.js";
import * as observeModule from "../../src/mutation/observe.js";
import * as rerunModule from "../../src/mutation/rerun.js";
import { MAX_MUTATIONS_PER_RESPONSE } from "../../src/mutation/operators.js";

afterEach(() => vi.restoreAllMocks());

describe("runMutations", () => {
  it("does not speculate about mocks when tests produce no HTTP traffic", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      calls: [],
      testsRan: 5,
      failingTests: [],
      sawAnyTraffic: false,
      baseline: { passed: true },
    });

    const report = await runMutations("/fake/dir");
    expect(report).toMatchObject({
      verdict: "incomplete",
      mode: "generic",
      outcomes: [
        {
          status: "incomplete",
          reason: expect.stringContaining("no HTTP traffic"),
          nextAction: expect.any(String),
        },
      ],
    });
    expect(report.outcomes[0]?.reason).toBe(
      "tests ran but no HTTP traffic was observed",
    );
    expect(report.outcomes[0]?.reason).not.toContain("likely mocks");
  });

  it("does not classify an ambiguous generic response", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      calls: [
        {
          method: "GET",
          url: "https://api.example.test/items",
          status: 200,
          body: { id: 1, tax: 250 },
          touchingTests: ["test/items.test.ts"],
          responseAmbiguous: true,
        },
      ],
      testsRan: 1,
      failingTests: [],
      sawAnyTraffic: true,
      baseline: { passed: true },
    });
    const rerunSpy = vi.spyOn(rerunModule, "rerun");

    const report = await runMutations("/fake/dir");

    expect(report.outcomes.length).toBeGreaterThan(0);
    expect(report.outcomes.every(({ status }) => status === "incomplete")).toBe(
      true,
    );
    expect(report.outcomes[0]).toMatchObject({
      reason: expect.stringContaining("different response bodies"),
      nextAction: expect.any(String),
    });
    expect(rerunSpy).not.toHaveBeenCalled();
  });

  it("skips unchanged generic mutations without rerunning them", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      calls: [
        {
          method: "GET",
          url: "https://api.example.test/items",
          status: 200,
          body: { zero: 0, nullable: null },
          touchingTests: ["test/items.test.ts"],
        },
      ],
      testsRan: 1,
      failingTests: [],
      sawAnyTraffic: true,
      baseline: { passed: true },
    });
    const rerunSpy = vi
      .spyOn(rerunModule, "rerun")
      .mockResolvedValue({ kind: "completed", testsRun: 1, testsFailed: 0 });

    const report = await runMutations("/fake/dir");

    expect(
      report.outcomes.some(
        ({ mutation }) =>
          mutation?.operator === "numeric-scale" &&
          mutation.fieldPath === "zero",
      ),
    ).toBe(false);
    expect(
      report.outcomes.some(
        ({ mutation }) =>
          mutation?.operator === "null-field" &&
          mutation.fieldPath === "nullable",
      ),
    ).toBe(false);
    expect(rerunSpy).toHaveBeenCalledTimes(report.outcomes.length);
  });

  it("does not spend the generic mutation cap on no-op candidates", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      calls: [
        {
          method: "GET",
          url: "https://api.example.test/items",
          status: 200,
          body: {
            zero1: 0,
            zero2: 0,
            zero3: 0,
            zero4: 0,
            label1: "active",
            label2: "active",
          },
          touchingTests: ["test/items.test.ts"],
        },
      ],
      testsRan: 1,
      failingTests: [],
      sawAnyTraffic: true,
      baseline: { passed: true },
    });
    const rerunSpy = vi
      .spyOn(rerunModule, "rerun")
      .mockResolvedValue({ kind: "completed", testsRun: 1, testsFailed: 0 });

    const report = await runMutations("/fake/dir");

    expect(report.outcomes).toHaveLength(MAX_MUTATIONS_PER_RESPONSE);
    expect(rerunSpy).toHaveBeenCalledTimes(MAX_MUTATIONS_PER_RESPONSE);
  });
});
