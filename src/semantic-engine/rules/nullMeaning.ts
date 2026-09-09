import type { RuleContext, Verdict } from "../types.js";

export function nullMeaning(
  oldField: unknown,
  newField: unknown,
  context: RuleContext,
): Verdict {
  const wasPresent = oldField !== null && oldField !== undefined;
  const isNowAbsent = newField === null || newField === undefined;

  if (wasPresent && isNowAbsent) {
    return {
      classification: "breaking",
      explanation: `removed with no successor: ${context.fieldPath} was previously required and is now null/absent, with no documented default`,
    };
  }
  return {
    classification: "unknown",
    explanation: "not a required-field-became-absent transition",
  };
}
