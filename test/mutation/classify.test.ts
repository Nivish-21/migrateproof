// test/mutation/classify.test.ts
import { describe, expect, it } from "vitest";
import {
  classifyOutcome,
  rankOutcomes,
  type MutationOutcome,
} from "../../src/mutation/classify.js";
import type { Mutation } from "../../src/mutation/operators.js";

const mutation: Mutation = {
  operator: "type-flip",
  fieldPath: "tax",
  before: 250,
  after: "250",
  description: 'tax: 250 -> "250" (type-flip)',
};

function outcome(
  endpoint: string,
  testsRun: number,
  testsFailed: number,
): MutationOutcome {
  return {
    endpoint,
    mutation,
    testsRun,
    testsFailed,
    classification: classifyOutcome(testsRun, testsFailed),
  };
}

describe("classifyOutcome", () => {
  it("classifies as caught when at least one affected test failed", () => {
    expect(classifyOutcome(3, 1)).toBe("caught");
  });

  it("classifies as gap when every affected test still passed", () => {
    expect(classifyOutcome(3, 0)).toBe("gap");
  });

  it("classifies as gap when no tests ran at all, never as caught", () => {
    expect(classifyOutcome(0, 0)).toBe("gap");
  });
});

describe("rankOutcomes", () => {
  it("ranks gaps above caught outcomes", () => {
    const ranked = rankOutcomes([outcome("/a", 2, 1), outcome("/b", 2, 0)]);
    expect(ranked[0]?.endpoint).toBe("/b");
  });

  it("ranks higher blast radius first within gaps", () => {
    const ranked = rankOutcomes([
      outcome("/small", 1, 0),
      outcome("/big", 9, 0),
    ]);
    expect(ranked[0]?.endpoint).toBe("/big");
  });

  it("does not mutate the input array", () => {
    const input = [outcome("/a", 1, 1), outcome("/b", 1, 0)];
    const first = input[0];
    rankOutcomes(input);
    expect(input[0]).toBe(first);
  });
});
