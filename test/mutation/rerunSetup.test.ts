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
});
