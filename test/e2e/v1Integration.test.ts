import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractInvariants } from "../../src/invariant-extraction/extractInvariants.js";
import { classifyDiff } from "../../src/semantic-engine/classify.js";
import type { DiffEntry } from "../../src/diff/computeDiff.js";

describe("V1 integration: invariant-extraction -> semantic-engine", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mp-v1-e2e-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("extracts a real invariant from a realistically-shaped consumer test file", () => {
    const testFile = join(dir, "checkout.test.ts");
    writeFileSync(
      testFile,
      `test("checkout total", () => {
        expect(result.total).toBe(2750);
        expect(result.currency).toBe("USD");
      });`,
    );
    const { generated, skipped } = extractInvariants(testFile, "result");
    expect(skipped).toEqual([]);
    expect(generated).toContain("_r.total === 2750");

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const predicate = new Function(
      "result",
      generated!
        .replace(/^export default \(result: unknown\) => \{/, "")
        .replace(/const _r = result as any;/, "const _r = result;")
        .replace(/\};\s*$/, ""),
    ) as (result: unknown) => boolean;
    expect(predicate({ total: 2750, currency: "USD" })).toBe(true);
    expect(predicate({ total: 1000, currency: "USD" })).toBe(false);
  });

  it("classifies one true instance of each break type as breaking, and the accompanying safe change as safe or unknown, never a false breaking", () => {
    const cases: {
      name: string;
      diff: DiffEntry[];
      expected: "safe" | "unknown";
      expectedBreaking: DiffEntry[];
    }[] = [
      {
        name: "unit",
        diff: [{ field: "price", from: 1000, to: 7 }],
        expected: "unknown",
        expectedBreaking: [{ field: "price", from: 1000, to: 10 }],
      },
      {
        name: "pagination",
        diff: [{ field: "items", from: [1, 2, 3], to: [3, 1, 2] }],
        expected: "safe",
        expectedBreaking: [{ field: "items", from: [1, 2, 3], to: [4, 5, 6] }],
      },
      {
        name: "null-meaning",
        diff: [{ field: "discount", from: 500, to: 500 }],
        expected: "unknown",
        expectedBreaking: [{ field: "discount", from: 500, to: null }],
      },
    ];

    for (const testCase of cases) {
      const safeVerdicts = classifyDiff(testCase.diff);
      const safeVerdict = safeVerdicts.get(testCase.diff[0].field);
      expect(safeVerdict?.classification).not.toBe("breaking");
      expect(safeVerdict?.classification).toBe(testCase.expected);

      const breakingVerdicts = classifyDiff(testCase.expectedBreaking);
      const breakingVerdict = breakingVerdicts.get(
        testCase.expectedBreaking[0].field,
      );
      expect(breakingVerdict?.classification).toBe(
        testCase.name === "null-meaning" || testCase.name === "unit"
          ? "breaking"
          : "unknown",
      );
    }
  });
});
