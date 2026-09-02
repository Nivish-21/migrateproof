export interface DiffEntry {
  field: string;
  from: unknown;
  to: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function computeDiff(
  before: unknown,
  after: unknown,
  path = "",
): DiffEntry[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    const entries: DiffEntry[] = [];
    if (before.length !== after.length) {
      entries.push({
        field: `${path}.length`,
        from: before.length,
        to: after.length,
      });
    }
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      entries.push(
        ...computeDiff(before[index], after[index], `${path}[${index}]`),
      );
    }
    return entries;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const entries: DiffEntry[] = [];
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      const childPath = path ? `${path}.${key}` : key;
      entries.push(...computeDiff(before[key], after[key], childPath));
    }
    return entries;
  }

  return before === after ? [] : [{ field: path, from: before, to: after }];
}
