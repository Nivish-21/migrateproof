// test/mutation/runMutations.test.ts
import { describe, expect, it, vi } from "vitest";
import { runMutations } from "../../src/mutation/runMutations.js";
import * as observeModule from "../../src/mutation/observe.js";

describe("runMutations", () => {
  it("reports unanalyzable when tests ran but no HTTP traffic was observed", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      calls: [],
      testsRan: 5,
      failingTests: [],
      sawAnyTraffic: false,
    });

    const report = await runMutations("/fake/dir");
    expect(report.unanalyzable.length).toBe(1);
    expect(report.unanalyzable[0]?.reason).toContain(
      "mocks above the HTTP layer",
    );
  });
});
