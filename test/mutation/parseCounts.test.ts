// test/mutation/parseCounts.test.ts
import { describe, expect, it } from "vitest";
import { parseCounts } from "../../src/mutation/rerun.js";

describe("parseCounts", () => {
  it("reads vitest output", () => {
    expect(parseCounts("Tests  3 passed, 1 failed (4)")).toEqual({
      testsRan: 4,
      testsFailed: 1,
    });
  });

  // Hermes runs `tsx --test`, whose reporter prints neither "passed" nor
  // "failed". Without this the parse yielded nothing and the caller filled the
  // hole with a fabricated count of 1 while 40 tests had actually run.
  it("reads node --test output", () => {
    const output = [
      "ℹ tests 40",
      "ℹ suites 0",
      "ℹ pass 40",
      "ℹ fail 0",
      "ℹ cancelled 0",
    ].join("\n");
    expect(parseCounts(output)).toEqual({ testsRan: 40, testsFailed: 0 });
  });

  it("reads a failing node --test run", () => {
    const output = ["ℹ tests 12", "ℹ pass 9", "ℹ fail 3"].join("\n");
    expect(parseCounts(output)).toEqual({ testsRan: 12, testsFailed: 3 });
  });

  it("returns zeroes when nothing is recognisable", () => {
    expect(parseCounts("some unrelated output")).toEqual({
      testsRan: 0,
      testsFailed: 0,
    });
  });
});
