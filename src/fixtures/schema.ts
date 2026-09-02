import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { UsageError } from "../errors.js";

const ResponseSchema = z
  .object({
    status: z.number(),
    body: z.unknown(),
  })
  .strict();

export const FixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string(),
    description: z.string().optional(),
    request: z
      .object({
        method: z.string(),
        url: z.string(),
      })
      .strict(),
    responses: z
      .object({
        v1: ResponseSchema.optional(),
        v2: ResponseSchema.optional(),
      })
      .strict()
      .optional(),
    invariant: z.string().optional(),
    consumer: z.string().optional(),
  })
  .strict();

export type Fixture = z.infer<typeof FixtureSchema>;

export class FixtureValidationError extends UsageError {}

export function loadFixtureYaml(fixtureDir: string): Fixture {
  const fixturePath = join(fixtureDir, "fixture.yaml");
  let raw: string;
  try {
    raw = readFileSync(fixturePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FixtureValidationError(
      `Unable to read ${fixturePath}: ${message}`,
    );
  }
  const parsed = yaml.load(raw);
  const result = FixtureSchema.safeParse(parsed);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new FixtureValidationError(
      `Invalid fixture.yaml at ${fixtureDir}:\n${messages.join("\n")}`,
    );
  }
  return result.data;
}
