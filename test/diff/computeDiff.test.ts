import { describe, expect, it } from "vitest";
import { computeDiff } from "../../src/diff/computeDiff.js";

describe("computeDiff", () => {
  it("returns [] for identical objects", () => {
    expect(computeDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("reports a single scalar field change with a dot path", () => {
    expect(computeDiff({ tax: 250 }, { tax: 2.5 })).toEqual([
      { field: "tax", from: 250, to: 2.5 },
    ]);
  });

  it("reports an array element change with a bracketed index path", () => {
    const before = { lineItems: [{ price: 1000 }, { price: 500 }] };
    const after = { lineItems: [{ price: 1000 }, { price: 5 }] };
    expect(computeDiff(before, after)).toEqual([
      { field: "lineItems[1].price", from: 500, to: 5 },
    ]);
  });

  it("reports an array length mismatch as its own .length entry, plus per-index diffs", () => {
    const before = { items: [1, 2] };
    const after = { items: [1, 2, 3] };
    const result = computeDiff(before, after);
    expect(result).toContainEqual({ field: "items.length", from: 2, to: 3 });
    expect(result).toContainEqual({
      field: "items[2]",
      from: undefined,
      to: 3,
    });
  });

  it("handles nested object-in-array-in-object paths unambiguously", () => {
    const before = { orders: [{ items: [{ price: 10 }] }] };
    const after = { orders: [{ items: [{ price: 20 }] }] };
    expect(computeDiff(before, after)).toEqual([
      { field: "orders[0].items[0].price", from: 10, to: 20 },
    ]);
  });
});
