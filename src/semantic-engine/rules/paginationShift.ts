import type { RuleContext, Verdict } from "../types.js";

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function multiset(values: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = canonicalize(v);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function hasDuplicates(map: Map<string, number>): boolean {
  for (const count of map.values()) {
    if (count > 1) return true;
  }
  return false;
}

function isSubsetMultiset(
  a: Map<string, number>,
  b: Map<string, number>,
): boolean {
  for (const [key, count] of a) {
    if ((b.get(key) ?? 0) < count) return false;
  }
  return true;
}

export function paginationShift(
  oldField: unknown,
  newField: unknown,
  context: RuleContext,
): Verdict {
  void context;
  if (!Array.isArray(oldField) || !Array.isArray(newField)) {
    return { classification: "unknown", explanation: "not both arrays" };
  }
  const oldSet = multiset(oldField);
  const newSet = multiset(newField);

  const sameMultiset =
    oldSet.size === newSet.size &&
    [...oldSet].every(([k, v]) => newSet.get(k) === v);
  if (sameMultiset) {
    return {
      classification: "safe",
      explanation:
        "drop-in: same element set, different order — safe unless consumer code depends on element order",
    };
  }

  if (hasDuplicates(oldSet) || hasDuplicates(newSet)) {
    return {
      classification: "unknown",
      explanation: "element sets differ beyond reordering or slicing",
    };
  }

  if (isSubsetMultiset(newSet, oldSet) || isSubsetMultiset(oldSet, newSet)) {
    return {
      classification: "safe",
      explanation:
        "drop-in: page-slice, subset of the same element set — safe unless consumer code depends on the exact page boundary",
    };
  }

  return {
    classification: "unknown",
    explanation: "element sets differ beyond reordering or slicing",
  };
}
