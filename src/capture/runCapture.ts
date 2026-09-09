import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { UsageError } from "../errors.js";
import { loadFixtureYaml } from "../fixtures/schema.js";

type CaptureSource = { url: string } | { file: string };

function hasStatusAndBody(
  value: unknown,
): value is { status: number; body: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "number" &&
    "body" in value
  );
}

export async function runCapture(
  fixtureDir: string,
  version: "v1" | "v2",
  source: CaptureSource,
): Promise<void> {
  const fixture = loadFixtureYaml(fixtureDir);
  let status: number;
  let body: unknown;

  if ("file" in source) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(source.file, "utf-8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UsageError(
        `--from-file ${source.file} is not valid JSON: ${message}`,
      );
    }
    if (hasStatusAndBody(raw)) {
      status = raw.status;
      body = raw.body;
    } else {
      status = 200;
      body = raw;
    }
  } else {
    let response: Response;
    try {
      response = await fetch(source.url, { method: fixture.request.method });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UsageError(
        `--url ${source.url} could not be reached: ${message}`,
      );
    }
    status = response.status;
    try {
      body = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UsageError(
        `--url ${source.url} did not return valid JSON: ${message}`,
      );
    }
  }

  const fixturePath = join(fixtureDir, "fixture.yaml");
  const document = yaml.load(readFileSync(fixturePath, "utf-8")) as Record<
    string,
    unknown
  >;
  const responses = document.responses;
  document.responses = {
    ...(typeof responses === "object" && responses !== null ? responses : {}),
    [version]: { status, body },
  };
  writeFileSync(fixturePath, yaml.dump(document));
}
