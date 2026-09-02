import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

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

export class FixtureValidationError extends Error {}

export function loadFixtureYaml(fixtureDir: string): Fixture {
  const raw = readFileSync(join(fixtureDir, "fixture.yaml"), "utf-8");
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
