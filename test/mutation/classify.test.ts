import { describe, expect, it } from "vitest";
import {
  classifyOutcome,
  rankOutcomes,
  type MutationOutcome,
} from "../../src/mutation/classify.js";

const caught: MutationOutcome = {
  endpoint: "GET https://api.example.com/orders/123",
  testFiles: ["test/charge.test.ts"],
  testsRun: 3,
  testsFailed: 1,
  status: "caught",
};

const missed: MutationOutcome = {
  ...caught,
  status: "missed",
  testsFailed: 0,
};

const incomplete: MutationOutcome = {
  ...caught,
  status: "incomplete",
  testsRun: 0,
  testsFailed: 0,
  reason: "the mutation was not served",
  nextAction: "run the selected test through globalThis.fetch",
};

describe("classifyOutcome", () => {
  it("classifies parsed passing tests as missed", () => {
    expect(classifyOutcome(3, 0)).toBe("missed");
  });

  it("classifies parsed failing tests as caught", () => {
    expect(classifyOutcome(3, 1)).toBe("caught");
  });

  it("does not claim a zero-test rerun was caught or missed", () => {
    expect(classifyOutcome(0, 0)).toBe("incomplete");
  });
});

describe("rankOutcomes", () => {
  it("ranks missed, incomplete, then caught outcomes", () => {
    const ranked = rankOutcomes([caught, incomplete, missed]);
    expect(ranked.map((outcome) => outcome.status)).toEqual([
      "missed",
      "incomplete",
      "caught",
    ]);
  });

  it("ranks higher blast radius first within a status", () => {
    const ranked = rankOutcomes([
      { ...missed, endpoint: "/small", testsRun: 1 },
      { ...missed, endpoint: "/big", testsRun: 9 },
    ]);
    expect(ranked[0]?.endpoint).toBe("/big");
  });

  it("does not mutate the input array", () => {
    const input = [caught, missed];
    const first = input[0];
    rankOutcomes(input);
    expect(input[0]).toBe(first);
  });
});
