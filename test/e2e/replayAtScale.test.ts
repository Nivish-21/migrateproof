import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = process.cwd();
const cliEntrypoint = join(repoRoot, "src/cli/index.ts");

describe("replay --all at CI scale", () => {
  let fixturesDir: string;
  const FIXTURE_COUNT = 100;

  beforeAll(() => {
    // discoverFixtures() in src/cli/replay.ts hardcodes join(cwd, "fixtures")
    // with no override (confirmed by reading it — no env var, no flag).
    // Rather than adding a test-only escape hatch to shipped code, structure
    // this temp dir as <fixturesDir>/fixtures/f-N/... and run the CLI with
    // cwd set to fixturesDir (not repoRoot) — discoverFixtures then finds
    // them with zero production code changes. The CLI entrypoint itself is
    // passed as an absolute path since cwd is no longer the repo root.
    fixturesDir = mkdtempSync(join(tmpdir(), "mp-scale-"));
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      const dir = join(fixturesDir, "fixtures", `f-${i}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "fixture.yaml"),
        [
          "schemaVersion: 1",
          `name: scale-${i}`,
          `request:\n  method: GET\n  url: https://api.example.com/scale/${i}`,
          `responses:\n  v1:\n    status: 200\n    body: { value: ${i} }`,
          "invariant: ./invariant.ts",
          "consumer: ./consumer.ts",
        ].join("\n"),
      );
      writeFileSync(
        join(dir, "consumer.ts"),
        `export default async function c() { const r = await fetch("https://api.example.com/scale/${i}"); return r.json(); }`,
      );
      writeFileSync(
        join(dir, "invariant.ts"),
        `export default (result: { value: number }) => result.value === ${i};`,
      );
    }
  });
  afterAll(() => rmSync(fixturesDir, { recursive: true, force: true }));

  it(`handles ${FIXTURE_COUNT} fixtures within a reasonable time and reports all of them`, async () => {
    const start = Date.now();
    const { stdout } = await execFileAsync(
      "node",
      [
        "--import",
        tsxLoader,
        cliEntrypoint,
        "replay",
        "--all",
        "--version",
        "v1",
        "--json",
      ],
      { cwd: fixturesDir },
    );
    expect(Date.now() - start).toBeLessThan(30_000);
    const results = JSON.parse(stdout);
    expect(results).toHaveLength(FIXTURE_COUNT);
    expect(results.every((r: { passed: boolean }) => r.passed)).toBe(true);
  }, 35_000);
});
