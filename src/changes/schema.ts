// src/changes/schema.ts
import { UsageError } from "../errors.js";

export type ChangeKind =
  | "removed"
  | "now-nullable"
  | "unit-change"
  | "type-changed"
  | "new-enum-value";

export interface ApiChange {
  endpoint: string; // "GET /v1/charges/{id}"
  field: string; // "customer.name"
  kind: ChangeKind;
  factor?: number; // required when kind === "unit-change"
  toType?: "string" | "number" | "boolean"; // required when kind === "type-changed"
  value?: unknown; // required when kind === "new-enum-value"
  note?: string;
}

export interface ChangesFile {
  api: string;
  from?: string;
  to?: string;
  source?: string;
  changes: ApiChange[];
}

const VALID_KINDS = new Set<string>([
  "removed",
  "now-nullable",
  "unit-change",
  "type-changed",
  "new-enum-value",
]);

const VALID_TO_TYPES = new Set<string>(["string", "number", "boolean"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseChangesFile(rawJson: string, path: string): ChangesFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new UsageError(`failed to parse changes file at ${path}: ${msg}`);
  }

  if (!isPlainObject(parsed)) {
    throw new UsageError(
      `invalid changes file at ${path}: root must be an object`,
    );
  }

  if (typeof parsed.api !== "string" || parsed.api.trim().length === 0) {
    throw new UsageError(
      `invalid changes file at ${path}: "api" is required and must be a non-empty string`,
    );
  }

  if (!Array.isArray(parsed.changes)) {
    throw new UsageError(
      `invalid changes file at ${path}: "changes" is required and must be an array`,
    );
  }

  const changes: ApiChange[] = [];

  for (let i = 0; i < parsed.changes.length; i++) {
    const entry: unknown = parsed.changes[i];
    if (!isPlainObject(entry)) {
      throw new UsageError(
        `invalid changes file at ${path}: changes[${i}] must be an object`,
      );
    }

    if (
      typeof entry.endpoint !== "string" ||
      entry.endpoint.trim().length === 0
    ) {
      throw new UsageError(
        `invalid changes file at ${path}: changes[${i}].endpoint must be a non-empty string`,
      );
    }

    if (typeof entry.field !== "string" || entry.field.trim().length === 0) {
      throw new UsageError(
        `invalid changes file at ${path}: changes[${i}].field must be a non-empty string`,
      );
    }

    if (typeof entry.kind !== "string" || !VALID_KINDS.has(entry.kind)) {
      throw new UsageError(
        `invalid changes file at ${path}: changes[${i}] has unknown kind "${String(entry.kind)}"` +
          ` (expected one of: ${Array.from(VALID_KINDS).join(", ")})`,
      );
    }

    const kind = entry.kind as ChangeKind;
    const change: ApiChange = {
      endpoint: entry.endpoint,
      field: entry.field,
      kind,
    };

    if (typeof entry.note === "string") {
      change.note = entry.note;
    }

    if (kind === "unit-change") {
      if (
        typeof entry.factor !== "number" ||
        !Number.isFinite(entry.factor) ||
        entry.factor === 0
      ) {
        throw new UsageError(
          `invalid changes file at ${path}: changes[${i}].factor must be a non-zero finite number for unit-change`,
        );
      }
      change.factor = entry.factor;
    } else if (kind === "type-changed") {
      const toTypeRaw = entry["to-type"];
      if (typeof toTypeRaw !== "string" || !VALID_TO_TYPES.has(toTypeRaw)) {
        throw new UsageError(
          `invalid changes file at ${path}: changes[${i}]["to-type"] must be one of: string, number, boolean for type-changed`,
        );
      }
      change.toType = toTypeRaw as "string" | "number" | "boolean";
    } else if (kind === "new-enum-value") {
      if (!("value" in entry)) {
        throw new UsageError(
          `invalid changes file at ${path}: changes[${i}].value is required for new-enum-value`,
        );
      }
      change.value = entry.value;
    }

    changes.push(change);
  }

  const result: ChangesFile = {
    api: parsed.api,
    changes,
  };

  if (typeof parsed.from === "string") {
    result.from = parsed.from;
  }
  if (typeof parsed.to === "string") {
    result.to = parsed.to;
  }
  if (typeof parsed.source === "string") {
    result.source = parsed.source;
  }

  return result;
}
