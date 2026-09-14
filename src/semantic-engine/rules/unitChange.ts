import type { RuleContext, Verdict } from "../types.js";

const RECOGNIZED_RATIOS = [100, 1000, 0.01, 0.001];
const EPSILON = 1e-9;

export function unitChange(
  oldField: unknown,
  newField: unknown,
  context: RuleContext,
): Verdict {
  if (typeof oldField !== "number" || typeof newField !== "number") {
    return { classification: "unknown", explanation: "not both numeric" };
  }
  if (oldField === 0 || newField === 0) {
    return {
      classification: "unknown",
      explanation: "cannot compute a ratio against zero",
    };
  }
  const ratio = newField / oldField;
  const matched = RECOGNIZED_RATIOS.find((r) => Math.abs(ratio - r) < EPSILON);
  if (matched === undefined) {
    return {
      classification: "unknown",
      explanation: "ratio does not match a recognized unit conversion",
    };
  }
  return {
    classification: "breaking",
    explanation: `unit change: ${context.fieldPath} scaled by ${matched} (behavior change — same field, different representation; consumer code must apply the same conversion)`,
  };
}
