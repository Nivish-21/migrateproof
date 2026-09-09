import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../src/patch/types.js";
import { classifyDiff } from "../../src/semantic-engine/classify.js";
import type { ReplayResult } from "../../src/replay/runReplay.js";

const failureTrace: ReplayResult = {
  fixture: "checkout-example",
  version: "v2",
  passed: false,
  invariant: "checkout-total-invariant",
  diff: [{ field: "price", from: 1000, to: 10 }],
  error: null,
};

describe("buildPrompt", () => {
  it("behaves identically to the MVP version when no verdicts are supplied", () => {
    const prompt = buildPrompt(failureTrace);
    expect(prompt).toContain(
      'Observed diff: [{"field":"price","from":1000,"to":10}]',
    );
  });

  it("appends a diff entry's explanation when a non-unknown Verdict is supplied", () => {
    const verdicts = classifyDiff(failureTrace.diff);
    const prompt = buildPrompt(failureTrace, verdicts);
    expect(prompt).toContain("price");
    expect(prompt).toContain("unit change");
    expect(prompt).not.toContain('[{"field":"price"');
  });

  it("omits a parenthetical explanation for a field whose verdict is unknown", () => {
    const unknownTrace: ReplayResult = {
      ...failureTrace,
      diff: [{ field: "label", from: "abc", to: "def" }],
    };
    const verdicts = classifyDiff(unknownTrace.diff);
    const prompt = buildPrompt(unknownTrace, verdicts);
    expect(prompt).toContain("label");
    expect(prompt).not.toContain("(unit change");
  });
});
