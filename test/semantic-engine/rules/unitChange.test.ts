import { describe, expect, it } from "vitest";
import { unitChange } from "../../../src/semantic-engine/rules/unitChange.js";

const ctx = { fieldPath: "price", oldValue: 1000, newValue: 10 };

describe("unitChange", () => {
  it("classifies a x100 ratio (cents to dollars) as safe", () => {
    const verdict = unitChange(1000, 10, ctx);
    expect(verdict.classification).toBe("safe");
  });

  it("falls back to unknown for a non-recognized ratio", () => {
    const verdict = unitChange(1000, 7, { ...ctx, newValue: 7 });
    expect(verdict.classification).toBe("unknown");
  });

  it("falls back to unknown when either value is not a number", () => {
    const verdict = unitChange("1000", 10, ctx);
    expect(verdict.classification).toBe("unknown");
  });

  it("falls back to unknown when newValue is 0 (no divide-by-zero throw)", () => {
    expect(() => unitChange(1000, 0, { ...ctx, newValue: 0 })).not.toThrow();
    expect(unitChange(1000, 0, { ...ctx, newValue: 0 }).classification).toBe(
      "unknown",
    );
  });
});
