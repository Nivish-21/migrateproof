import { describe, expect, it, vi } from "vitest";
import { runMutations } from "../../src/mutation/runMutations.js";
import * as observeModule from "../../src/mutation/observe.js";

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
});
