import { describe, expect, it } from "vitest";
import { assertNotNestedRun } from "../../src/mutation/observe.js";
import { UsageError } from "../../src/errors.js";

describe("assertNotNestedRun", () => {
  it("throws UsageError when already running under an observe pass", () => {
    expect(() => assertNotNestedRun({ MIGRATEPROOF_OBSERVING: "1" })).toThrow(
      UsageError,
    );
  });

  it("names recursion as the reason, so the failure is self-explanatory", () => {
    expect(() => assertNotNestedRun({ MIGRATEPROOF_OBSERVING: "1" })).toThrow(
      /recurse without bound/,
    );
  });

  it("does not throw in a normal run", () => {
    expect(() => assertNotNestedRun({})).not.toThrow();
  });

  it("only treats the exact marker value as nested", () => {
    expect(() =>
      assertNotNestedRun({ MIGRATEPROOF_OBSERVING: "0" }),
    ).not.toThrow();
  });
});
