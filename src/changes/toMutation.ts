// src/changes/toMutation.ts
import type { Mutation, MutationOperator } from "../mutation/operators.js";
import type { ApiChange } from "./schema.js";

export type ToMutationResult =
  | { ok: true; mutation: Mutation }
  | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceToType(
  value: unknown,
  toType: "string" | "number" | "boolean",
): unknown {
  switch (toType) {
    case "string":
      return String(value);
    case "number":
      return Number(value);
    case "boolean":
      return Boolean(value);
  }
}

export function toMutation(
  change: ApiChange,
  body: unknown,
): ToMutationResult {
  const segments = change.field.split(".");
  if (segments.length === 0 || change.field.trim().length === 0) {
    return {
      ok: false,
      reason: "field not present in the recorded response",
    };
  }

  let cursor: unknown = body;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(cursor) || !(segment in cursor)) {
      return {
        ok: false,
        reason: "field not present in the recorded response",
      };
    }
    cursor = cursor[segment];
  }

  const lastSegment = segments[segments.length - 1];
  if (
    lastSegment === undefined ||
    !isPlainObject(cursor) ||
    !(lastSegment in cursor)
  ) {
    return {
      ok: false,
      reason: "field not present in the recorded response",
    };
  }

  const before = cursor[lastSegment];

  let operator: MutationOperator;
  let after: unknown;

  switch (change.kind) {
    case "unit-change": {
      if (typeof before !== "number") {
        return {
          ok: false,
          reason: `field "${change.field}" is not a number in the recorded response`,
        };
      }
      operator = "numeric-scale";
      after = before * (change.factor ?? 1);
      break;
    }
    case "removed": {
      operator = "remove-field";
      after = undefined;
      break;
    }
    case "now-nullable": {
      operator = "null-field";
      after = null;
      break;
    }
    case "type-changed": {
      operator = "type-flip";
      after = coerceToType(before, change.toType ?? "string");
      break;
    }
    case "new-enum-value": {
      operator = "new-enum-value";
      after = change.value;
      break;
    }
  }

  let description =
    operator === "remove-field"
      ? `${change.field} removed entirely`
      : `${change.field}: ${JSON.stringify(before)} -> ${JSON.stringify(after)} (${operator})`;

  if (change.note) {
    description += ` (${change.note})`;
  }

  return {
    ok: true,
    mutation: {
      operator,
      fieldPath: change.field,
      before,
      after,
      description,
    },
  };
}
