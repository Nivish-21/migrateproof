import { describe, expect, it } from "vitest";
import { nullMeaning } from "../../../src/semantic-engine/rules/nullMeaning.js";

const ctx = { fieldPath: "discount", oldValue: 500, newValue: null };

describe("nullMeaning", () => {
  it("classifies a required field going null as breaking", () => {
    const verdict = nullMeaning(500, null, ctx);
    expect(verdict.classification).toBe("breaking");
  });

  it("classifies a required field going undefined (removed) as breaking", () => {
    const verdict = nullMeaning(500, undefined, {
      ...ctx,
      newValue: undefined,
    });
    expect(verdict.classification).toBe("breaking");
  });

  it("falls back to unknown when the field was already null/undefined before", () => {
    expect(nullMeaning(null, null, ctx).classification).toBe("unknown");
    expect(nullMeaning(undefined, undefined, ctx).classification).toBe(
      "unknown",
    );
  });

  it("falls back to unknown when the new value is falsy but present (0, false, empty string)", () => {
    expect(nullMeaning(500, 0, { ...ctx, newValue: 0 }).classification).toBe(
      "unknown",
    );
    expect(
      nullMeaning(true, false, { ...ctx, newValue: false }).classification,
    ).toBe("unknown");
    expect(nullMeaning("x", "", { ...ctx, newValue: "" }).classification).toBe(
      "unknown",
    );
  });
});
