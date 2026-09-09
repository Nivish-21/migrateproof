import { describe, expect, it } from "vitest";
import { paginationShift } from "../../../src/semantic-engine/rules/paginationShift.js";

const ctx = { fieldPath: "items", oldValue: null, newValue: null };

describe("paginationShift", () => {
  it("classifies a reordered array with the same elements as safe", () => {
    const verdict = paginationShift([1, 2, 3], [3, 1, 2], ctx);
    expect(verdict.classification).toBe("safe");
  });

  it("classifies a page-slice (subset) as safe", () => {
    const verdict = paginationShift([1, 2, 3, 4], [2, 3], ctx);
    expect(verdict.classification).toBe("safe");
  });

  it("falls back to unknown when duplicate counts differ ([1,1,2] vs [1,2])", () => {
    const verdict = paginationShift([1, 1, 2], [1, 2], ctx);
    expect(verdict.classification).toBe("unknown");
  });

  it("falls back to unknown when either side isn't an array", () => {
    expect(paginationShift([1, 2], "not an array", ctx).classification).toBe(
      "unknown",
    );
  });

  it("works with arrays of objects via deep multiset comparison", () => {
    const verdict = paginationShift(
      [{ id: 1 }, { id: 2 }],
      [{ id: 2 }, { id: 1 }],
      ctx,
    );
    expect(verdict.classification).toBe("safe");
  });
});
