import type { DiffEntry } from "../diff/computeDiff.js";
import { nullMeaning } from "./rules/nullMeaning.js";
import { paginationShift } from "./rules/paginationShift.js";
import { unitChange } from "./rules/unitChange.js";
import type { RuleContext, SemanticRule, Verdict } from "./types.js";

const RULES: SemanticRule[] = [unitChange, paginationShift, nullMeaning];

export function classifyChange(
  oldValue: unknown,
  newValue: unknown,
  context: RuleContext,
): Verdict {
  for (const rule of RULES) {
    const verdict = rule(oldValue, newValue, context);
    if (verdict.classification !== "unknown") {
      return verdict;
    }
  }
  return {
    classification: "unknown",
    explanation: "no starter rule matched this change",
  };
}

export function classifyDiff(diff: DiffEntry[] | null): Map<string, Verdict> {
  const map = new Map<string, Verdict>();
  for (const entry of diff ?? []) {
    map.set(
      entry.field,
      classifyChange(entry.from, entry.to, {
        fieldPath: entry.field,
        oldValue: entry.from,
        newValue: entry.to,
      }),
    );
  }
  return map;
}
