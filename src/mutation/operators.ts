// src/mutation/operators.ts
export type MutationOperator =
  "numeric-scale" | "type-flip" | "null-field" | "remove-field" | "empty-array";

export interface Mutation {
  operator: MutationOperator;
  fieldPath: string;
  before: unknown;
  after: unknown;
  description: string;
}

const SCALE_DIVISOR = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(
  fieldPath: string,
  operator: MutationOperator,
  before: unknown,
  after: unknown,
): string {
  if (operator === "remove-field") return `${fieldPath} removed entirely`;
  return `${fieldPath}: ${JSON.stringify(before)} -> ${JSON.stringify(after)} (${operator})`;
}

function push(
  out: Mutation[],
  fieldPath: string,
  operator: MutationOperator,
  before: unknown,
  after: unknown,
): void {
  out.push({
    operator,
    fieldPath,
    before,
    after,
    description: describe(fieldPath, operator, before, after),
  });
}

function walk(value: unknown, prefix: string, out: Mutation[]): void {
  if (!isPlainObject(value)) return;

  for (const [key, fieldValue] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;

    push(out, path, "null-field", fieldValue, null);
    push(out, path, "remove-field", fieldValue, undefined);

    if (typeof fieldValue === "number") {
      push(out, path, "numeric-scale", fieldValue, fieldValue / SCALE_DIVISOR);
      push(out, path, "type-flip", fieldValue, String(fieldValue));
    }

    if (Array.isArray(fieldValue) && fieldValue.length > 0) {
      push(out, path, "empty-array", fieldValue, []);
    }

    if (isPlainObject(fieldValue)) {
      walk(fieldValue, path, out);
    }
  }
}

export function generateMutations(body: unknown): Mutation[] {
  const out: Mutation[] = [];
  walk(body, "", out);
  return out;
}

export function applyMutation(body: unknown, mutation: Mutation): unknown {
  const clone = structuredClone(body);
  const segments = mutation.fieldPath.split(".");
  const lastSegment = segments[segments.length - 1];

  let cursor: unknown = clone;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(cursor)) return clone;
    cursor = cursor[segment];
  }
  if (!isPlainObject(cursor) || lastSegment === undefined) return clone;

  if (mutation.operator === "remove-field") {
    delete cursor[lastSegment];
  } else {
    cursor[lastSegment] = mutation.after;
  }
  return clone;
}
