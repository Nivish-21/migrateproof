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

// Each mutation costs one full spawn of the target project's test runner, so
// this count is a direct multiplier on how long a scan takes and how hard it
// hits the machine. An unbounded set is not viable: a single realistic API
// response (a GitHub repo object, measured) generates 59 mutations, which
// means 59 sequential test-runner startups for one endpoint.
export const MAX_MUTATIONS_PER_RESPONSE = 12;

// Ordered by how often each models a real, observed API break. When the cap
// forces a choice, the earlier operators survive. numeric-scale leads because
// a silent cents-to-dollars shift is the exact failure this tool exists to
// catch; remove-field trails because a missing field usually breaks loudly on
// its own and needs no help being noticed.
const OPERATOR_PRIORITY: MutationOperator[] = [
  "numeric-scale",
  "type-flip",
  "null-field",
  "empty-array",
  "remove-field",
];

export function generateMutations(body: unknown): Mutation[] {
  const out: Mutation[] = [];
  walk(body, "", out);

  if (out.length <= MAX_MUTATIONS_PER_RESPONSE) return out;

  // Round-robin by operator rather than taking the first N, so the cap never
  // spends every slot on one operator applied to twelve different fields.
  const byOperator = new Map<MutationOperator, Mutation[]>();
  for (const mutation of out) {
    const existing = byOperator.get(mutation.operator) ?? [];
    existing.push(mutation);
    byOperator.set(mutation.operator, existing);
  }

  const selected: Mutation[] = [];
  let round = 0;
  while (selected.length < MAX_MUTATIONS_PER_RESPONSE) {
    let addedThisRound = false;
    for (const operator of OPERATOR_PRIORITY) {
      const candidate = byOperator.get(operator)?.[round];
      if (!candidate) continue;
      selected.push(candidate);
      addedThisRound = true;
      if (selected.length === MAX_MUTATIONS_PER_RESPONSE) break;
    }
    if (!addedThisRound) break;
    round += 1;
  }
  return selected;
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
