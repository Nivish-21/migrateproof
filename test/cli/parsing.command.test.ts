import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(".");

async function run(args: string[]) {
  try {
    const result = await execFileAsync(
      "node",
      ["--import", "tsx", "src/cli/index.ts", ...args],
      { cwd: repoRoot },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const commandError = error as {
      code: number;
      stdout: string;
      stderr: string;
    };
    return {
      code: commandError.code,
      stdout: commandError.stdout,
      stderr: commandError.stderr,
    };
  }
}

describe("CLI argument-parsing errors", () => {
  it("exits 2 on a missing required option", async () => {
    const result = await run(["capture", "fixtures/checkout-example"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--as");
  });

  it("exits 2 on a missing required argument", async () => {
    const result = await run(["patch"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("fixture-dir");
  });

  it("exits 2 on an unknown command", async () => {
    const result = await run(["bogus-command"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown command");
  });

  it("routes bare invocation to scan, refusing self-scan when run from repo root", async () => {
    const result = await run([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "refusing to scan MigrateProof's own repository",
    );
  });

  it("still exits 0 on --help", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
  });

  it("still exits 0 on a real usage error's happy-path sibling", async () => {
    const result = await run(["capture", "--help"]);
    expect(result.code).toBe(0);
  });
});
