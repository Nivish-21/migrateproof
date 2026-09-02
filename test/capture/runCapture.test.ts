import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { UsageError } from "../../src/errors.js";
import { runCapture } from "../../src/capture/runCapture.js";

interface CapturedResponse {
  status: number;
  body: unknown;
}

interface CapturedFixture {
  responses?: { v1?: CapturedResponse; v2?: CapturedResponse };
}

function readFixture(directory: string): CapturedFixture {
  return yaml.load(
    readFileSync(join(directory, "fixture.yaml"), "utf-8"),
  ) as CapturedFixture;
}

describe("runCapture", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mp-capture-"));
    writeFileSync(
      join(directory, "fixture.yaml"),
      "schemaVersion: 1\nname: t\nrequest:\n  method: GET\n  url: https://api.example.com/x\n",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(directory, { recursive: true });
  });

  it("writes responses.v1 from --from-file, defaulting status to 200", async () => {
    const dataFile = join(directory, "data.json");
    writeFileSync(dataFile, JSON.stringify({ total: 2750 }));

    await runCapture(directory, "v1", { file: dataFile });

    expect(readFixture(directory).responses?.v1).toEqual({
      status: 200,
      body: { total: 2750 },
    });
  });

  it("takes both status and body when the file is shaped as {status, body}", async () => {
    const dataFile = join(directory, "data.json");
    writeFileSync(
      dataFile,
      JSON.stringify({ status: 404, body: { error: "not found" } }),
    );

    await runCapture(directory, "v1", { file: dataFile });

    expect(readFixture(directory).responses?.v1).toEqual({
      status: 404,
      body: { error: "not found" },
    });
  });

  it("throws UsageError on non-JSON file content, writing nothing", async () => {
    const dataFile = join(directory, "bad.json");
    writeFileSync(dataFile, "not json{{{");

    await expect(
      runCapture(directory, "v1", { file: dataFile }),
    ).rejects.toThrow(UsageError);

    expect(readFixture(directory).responses).toBeUndefined();
  });

  it("captures via --url using the fixture-declared method, any status as-is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 500,
        json: async () => ({ error: "server error" }),
      }),
    );

    await runCapture(directory, "v2", { url: "https://api.example.com/x" });

    expect(readFixture(directory).responses?.v2).toEqual({
      status: 500,
      body: { error: "server error" },
    });
  });
});
