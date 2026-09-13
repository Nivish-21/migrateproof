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

describe("ephemeral-port projects", () => {
  // Regression guard. A project that binds a fresh random port per test used
  // to produce a new endpoint identity on every run, so nothing could be
  // intercepted at re-run time and the report named ports that no longer
  // existed. observe() now strips the port from loopback URLs.
  it("recognises one endpoint despite a new random port each run, and finds its gaps", async () => {
    const report = await runMutations(
      resolve("test/integration/ephemeral-port-project"),
    );

    expect(hasGaps(report)).toBe(true);

    // One logical endpoint, not one per port.
    const endpoints = new Set(report.outcomes.map((o) => o.endpoint));
    expect(endpoints.size).toBe(1);

    // The surviving identity carries no port.
    const [endpoint] = [...endpoints];
    expect(endpoint).not.toMatch(/localhost:\d+/);

    // And the weak test genuinely fails to catch a tax change.
    expect(
      report.outcomes.some(
        (o) => o.mutation.fieldPath === "tax" && o.classification === "gap",
      ),
    ).toBe(true);
  }, 180_000);
});
