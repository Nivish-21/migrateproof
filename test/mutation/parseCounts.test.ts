// test/mutation/parseCounts.test.ts
import { describe, expect, it } from "vitest";
import { parseCounts } from "../../src/mutation/rerun.js";

describe("parseCounts", () => {
  it("reads vitest output", () => {
    expect(parseCounts("Tests  3 passed, 1 failed (4)")).toEqual({
      testsRan: 4,
      testsFailed: 1,
    });
    expect(parseCounts("Tests 1 failed | 2 passed (3)")).toEqual({
      testsRan: 3,
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

  it("ignores application log prose that mentions failed requests", () => {
    expect(
      parseCounts("1 failed request\n# tests 1\n# pass 1\n# fail 0\n"),
    ).toEqual({ testsRan: 1, testsFailed: 0 });
  });

  it("reads Jest and Vitest summary lines", () => {
    expect(parseCounts("Tests:       1 failed, 2 passed, 3 total")).toEqual({
      testsRan: 3,
      testsFailed: 1,
    });
    expect(parseCounts("Tests:       1 failed, 1 total")).toEqual({
      testsRan: 1,
      testsFailed: 1,
    });
    expect(parseCounts("Tests  3 passed, 1 failed (4)")).toEqual({
      testsRan: 4,
      testsFailed: 1,
    });
  });

  it("strips ANSI escapes before reading a Node test summary", () => {
    expect(
      parseCounts("\u001b[1mℹ tests 2\u001b[22m\nℹ pass 2\nℹ fail 0\n"),
    ).toEqual({ testsRan: 2, testsFailed: 0 });
  });

  it("rejects contradictory Node test totals", () => {
    expect(parseCounts("# tests 2\n# pass 2\n# fail 1\n")).toEqual({
      testsRan: 0,
      testsFailed: 0,
    });
  });

  it("returns zeroes when nothing is recognisable", () => {
    expect(parseCounts("some unrelated output")).toEqual({
      testsRan: 0,
      testsFailed: 0,
    });
  });
});
