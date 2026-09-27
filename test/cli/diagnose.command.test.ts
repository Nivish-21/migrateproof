// test/cli/diagnose.command.test.ts
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

function writeThrowingFixture(directory: string): void {
  const fixtureDir = join(directory, "fixtures", "throws");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, "fixture.yaml"),
    [
      "schemaVersion: 1",
      "name: throws",
      "request:",
      "  method: GET",
      "  url: https://api.example.com/orders/1",
      "responses:",
      "  v2:",
      "    status: 200",
      "    body: { created: true }",
      "invariant: ./invariant.ts",
      "consumer: ./consumer.ts",
    ].join("\n"),
  );
  writeFileSync(
    join(fixtureDir, "consumer.ts"),
    [
      "export default async function consumer() {",
      "  const response = await fetch('https://api.example.com/orders/1');",
      "  return response.json();",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(fixtureDir, "invariant.ts"),
    'export default () => { throw new Error("payment invariant exploded"); };',
  );
}

async function runDiagnoseWithThrowingInvariant(
  directory: string,
  json: boolean,
): Promise<{ code: number; stdout: string }> {
  try {
    await execFileAsync(
      "node",
      [
        "--import",
        tsxLoader,
        join(repoRoot, "src/cli/index.ts"),
        "diagnose",
        "fixtures/throws",
        ...(json ? ["--json"] : []),
      ],
      { cwd: directory },
    );
  } catch (error) {
    return error as { code: number; stdout: string };
  }
  throw new Error("expected diagnose to exit 2 when the invariant throws");
}

describe("diagnose command", () => {
  it("classifies the checkout-example's v2 change and exits 1", async () => {
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          "src/cli/index.ts",
          "diagnose",
          "fixtures/checkout-example",
        ],
        { cwd: repoRoot },
      );
      throw new Error("expected diagnose to exit 1 on a failing v2");
    } catch (error) {
      const commandError = error as { code: number; stdout: string };
      expect(commandError.code).toBe(1);
      expect(commandError.stdout).toContain("tax");
    }
  });

  it("supports --json", async () => {
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          "src/cli/index.ts",
          "diagnose",
          "fixtures/checkout-example",
          "--json",
        ],
        { cwd: repoRoot },
      );
      throw new Error("expected diagnose --json to exit 1 on a failing v2");
    } catch (error) {
      const commandError = error as { code: number; stdout: string };
      expect(commandError.code).toBe(1);
      const parsed = JSON.parse(commandError.stdout);
      expect(parsed.passed).toBe(false);
      expect(parsed.verdicts).toHaveProperty("tax");
    }
  });

  it("retains invariant errors in human output and exits 2", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mp-diagnose-"));
    try {
      writeThrowingFixture(directory);
      const commandError = await runDiagnoseWithThrowingInvariant(
        directory,
        false,
      );

      expect(commandError.code).toBe(2);
      expect(commandError.stdout).toContain("payment invariant exploded");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains invariant errors in JSON output and exits 2", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mp-diagnose-"));
    try {
      writeThrowingFixture(directory);
      const commandError = await runDiagnoseWithThrowingInvariant(
        directory,
        true,
      );
      const result = JSON.parse(commandError.stdout);

      expect(commandError.code).toBe(2);
      expect(result.error).toBe("payment invariant exploded");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
