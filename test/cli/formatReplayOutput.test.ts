import { describe, expect, it } from "vitest";
import { formatHumanReadable } from "../../src/cli/formatReplayOutput.js";
import type { ReplayResult } from "../../src/replay/runReplay.js";

describe("formatHumanReadable", () => {
  it("formats a pass", () => {
    const result: ReplayResult = {
      fixture: "checkout-example",
      version: "v1",
      passed: true,
      invariant: "checkout-total-invariant",
      diff: null,
      error: null,
    };

    expect(formatHumanReadable(result)).toBe(
      "✓ checkout-example (v1) — invariant held",
    );
  });

  it("formats a fail with indented diff lines", () => {
    const result: ReplayResult = {
      fixture: "checkout-example",
      version: "v2",
      passed: false,
      invariant: "checkout-total-invariant",
      diff: [{ field: "tax", from: 250, to: 2.5 }],
      error: null,
    };

    expect(formatHumanReadable(result)).toBe(
      "✗ checkout-example (v2) — invariant failed: checkout-total-invariant\n  tax: 250 → 2.5",
    );
  });

  it("formats an errored invariant", () => {
    const result: ReplayResult = {
      fixture: "checkout-example",
      version: "v1",
      passed: false,
      invariant: "checkout-total-invariant",
      diff: null,
      error: "broken predicate",
    };

    expect(formatHumanReadable(result)).toBe(
      "⚠ checkout-example (v1) — invariant threw: broken predicate",
    );
  });
});
