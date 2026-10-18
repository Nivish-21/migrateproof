import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const setupPath = resolve("src/mutation/rerunSetup.ts");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function runFetch(requestUrl: string, resultPath: string): Promise<void> {
  await execFileAsync(
    "node",
    [
      "--import",
      tsxLoader,
      "--import",
      setupPath,
      "--input-type=module",
      "--eval",
      "globalThis.fetch = async () => new Response('{}'); await fetch(process.env.REQUEST_URL);",
    ],
    {
      env: {
        ...process.env,
        REQUEST_URL: requestUrl,
        MIGRATEPROOF_MUTATION_CONFIG: JSON.stringify({
          method: "GET",
          url: "https://api.example.test/orders?expand=customer",
          mutatedBody: { id: "mutated" },
        }),
        MIGRATEPROOF_MUTATION_RESULT_PATH: resultPath,
      },
    },
  );
}

describe("rerun setup", () => {
  it("confirms only after serving a matching query-string mutation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-rerun-setup-"));
    tempDirs.push(dir);
    const resultPath = join(dir, "result.json");

    await runFetch(
      "https://api.example.test/orders?expand=customer",
      resultPath,
    );

    expect(existsSync(resultPath)).toBe(true);
  });

  it("does not confirm a request with a different query string", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-rerun-setup-"));
    tempDirs.push(dir);
    const resultPath = join(dir, "result.json");

    await runFetch("https://api.example.test/orders?expand=items", resultPath);

    expect(existsSync(resultPath)).toBe(false);
  });

  async function runTransform(
    stub: string,
    transform: Record<string, unknown>,
    resultPath: string,
  ): Promise<unknown> {
    const { stdout } = await execFileAsync(
      "node",
      [
        "--import",
        tsxLoader,
        "--import",
        setupPath,
        "--input-type=module",
        "--eval",
        `globalThis.fetch = ${stub}; const r = await fetch("https://api.example.test/item"); console.log(JSON.stringify({ status: r.status, body: await r.json() }));`,
      ],
      {
        env: {
          ...process.env,
          MIGRATEPROOF_MUTATION_CONFIG: JSON.stringify({
            method: "GET",
            url: "https://api.example.test/item",
            mutatedBody: { recorded: true },
            transform,
          }),
          MIGRATEPROOF_MUTATION_RESULT_PATH: resultPath,
        },
      },
    );
    return JSON.parse(stdout) as unknown;
  }

  it.each([
    [
      "scales this response's own value",
      "async () => new Response('{\"amount\":7}')",
      { fieldPath: "amount", op: "scale", factor: 100 },
      { amount: 700 },
    ],
    [
      "mutates a plain-object mock",
      'async () => ({ ok: true, status: 201, json: async () => ({ runtime: { stage: "RUNNING" } }) })',
      { fieldPath: "runtime.stage", op: "set", value: "PAUSED" },
      { runtime: { stage: "PAUSED" } },
    ],
    [
      "removes a nested field",
      "async () => new Response('{\"a\":{\"b\":1,\"c\":2}}')",
      { fieldPath: "a.b", op: "remove" },
      { a: { c: 2 } },
    ],
    [
      "coerces a value to another type",
      "async () => new Response('{\"id\":42}')",
      { fieldPath: "id", op: "coerce", toType: "string" },
      { id: "42" },
    ],
  ])("%s", async (_name, stub, transform, expectedBody) => {
    const dir = mkdtempSync(join(tmpdir(), "mp-rerun-setup-"));
    tempDirs.push(dir);
    const resultPath = join(dir, "result.json");

    const result = await runTransform(stub, transform, resultPath);

    expect(result).toMatchObject({ body: expectedBody });
    expect(existsSync(resultPath)).toBe(true);
  });

  it("keeps the mock's status when serving its mutated body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-rerun-setup-"));
    tempDirs.push(dir);

    const result = await runTransform(
      'async () => ({ ok: true, status: 201, json: async () => ({ a: 1 }) })',
      { fieldPath: "a", op: "set", value: null },
      join(dir, "result.json"),
    );

    expect(result).toEqual({ status: 201, body: { a: null } });
  });

  it("passes a response through unchanged, unconfirmed, when the field is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-rerun-setup-"));
    tempDirs.push(dir);
    const resultPath = join(dir, "result.json");

    const result = await runTransform(
      "async () => new Response('{\"other\":1}')",
      { fieldPath: "amount", op: "remove" },
      resultPath,
    );

    expect(result).toMatchObject({ body: { other: 1 } });
    expect(existsSync(resultPath)).toBe(false);
  });

  it("falls back to the recorded mutated body when the original call fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-rerun-setup-"));
    tempDirs.push(dir);
    const resultPath = join(dir, "result.json");

    const result = await runTransform(
      'async () => { throw new Error("offline"); }',
      { fieldPath: "amount", op: "remove" },
      resultPath,
    );

    expect(result).toMatchObject({ body: { recorded: true } });
    expect(existsSync(resultPath)).toBe(true);
  });
});
