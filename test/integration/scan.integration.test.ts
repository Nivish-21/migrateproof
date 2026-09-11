// test/integration/scan.integration.test.ts
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runMutations } from "../../src/mutation/runMutations.js";
import { hasGaps } from "../../src/mutation/report.js";

describe("scan integration", () => {
  it("reports gaps for a deliberately weak test suite", async () => {
    const report = await runMutations(resolve("test/integration/weak-project"));
    expect(hasGaps(report)).toBe(true);
    const taxGaps = report.outcomes.filter(
      (o) => o.mutation.fieldPath === "tax" && o.classification === "gap",
    );
    expect(taxGaps.length).toBeGreaterThan(0);
  }, 120_000);

  it("reports no tax gaps for a deliberately strong test suite", async () => {
    const report = await runMutations(
      resolve("test/integration/strong-project"),
    );
    const taxGaps = report.outcomes.filter(
      (o) => o.mutation.fieldPath === "tax" && o.classification === "gap",
    );
    expect(taxGaps).toEqual([]);
  }, 120_000);
});
