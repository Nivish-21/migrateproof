import { describe, expect, it } from "vitest";
import {
  classifyChange,
  classifyDiff,
} from "../../src/semantic-engine/classify.js";

describe("classifyChange", () => {
  it("returns the first non-unknown rule's verdict in fixed order (unit-change wins over the others when it matches)", () => {
    const verdict = classifyChange(1000, 10, {
      fieldPath: "price",
      oldValue: 1000,
      newValue: 10,
    });
    expect(verdict.classification).toBe("breaking");
    expect(verdict.explanation).toContain("unit change");
  });

  it("falls back to unknown when no rule matches", () => {
    const verdict = classifyChange("abc", "def", {
      fieldPath: "label",
      oldValue: "abc",
      newValue: "def",
    });
    expect(verdict.classification).toBe("unknown");
  });

  it("does not throw on undefined input (field added/removed)", () => {
    expect(() =>
      classifyChange(undefined, "new", {
        fieldPath: "extra",
        oldValue: undefined,
        newValue: "new",
      }),
    ).not.toThrow();
  });
});

describe("classifyDiff", () => {
  it("returns an empty map for a null diff", () => {
    expect(classifyDiff(null).size).toBe(0);
  });

  it("keys the map by each diff entry's field path", () => {
    const map = classifyDiff([{ field: "price", from: 1000, to: 10 }]);
    expect(map.get("price")?.classification).toBe("breaking");
  });
});
