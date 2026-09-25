import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const call = {
  method: "GET",
  url: "https://api.example.test/orders?expand=customer",
  status: 200,
  body: { id: "original" },
  touchingTests: ["test/orders.test.ts"],
};

let tempDir: string;

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

async function loadRerun(
  result:
    | { output: string; marker: boolean }
    | { error: Record<string, unknown>; marker: boolean },
): Promise<
  (
    projectRoot: string,
    observedCall: typeof call,
    body: unknown,
  ) => Promise<unknown>
> {
  tempDir = mkdtempSync(join(tmpdir(), "mp-rerun-"));
  mkdirSync(join(tempDir, "node_modules"));
  writeFileSync(
    join(tempDir, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }),
  );
  const custom = async (
    _command: string,
    _args: string[],
    options: { env: NodeJS.ProcessEnv },
  ): Promise<{ stdout: string; stderr: string }> => {
    if (result.marker) {
      writeFileSync(options.env.MIGRATEPROOF_MUTATION_RESULT_PATH!, "{}");
    }
    if ("error" in result) throw result.error;
    return { stdout: result.output, stderr: "" };
  };
  (execFileMock as unknown as Record<symbol, unknown>)[promisify.custom] =
    custom;
  const module = await import("../../src/mutation/rerun.js");
  return module.rerun;
}

describe("rerun", () => {
  it("returns incomplete when a successful runner reports no tests", async () => {
    const rerun = await loadRerun({ output: "done", marker: true });
    await expect(
      rerun(tempDir, call, { id: "mutated" }),
    ).resolves.toMatchObject({
      kind: "incomplete",
      testsRun: 0,
    });
  });

  it("returns incomplete when the runner times out", async () => {
    const rerun = await loadRerun({
      error: { killed: true, signal: "SIGTERM", stdout: "" },
      marker: true,
    });
    await expect(
      rerun(tempDir, call, { id: "mutated" }),
    ).resolves.toMatchObject({
      kind: "incomplete",
      reason: expect.stringContaining("timed out"),
    });
  });

  it("returns incomplete for a non-test runner failure", async () => {
    const rerun = await loadRerun({
      error: { code: 1, stdout: "fatal configuration error" },
      marker: true,
    });
    await expect(
      rerun(tempDir, call, { id: "mutated" }),
    ).resolves.toMatchObject({
      kind: "incomplete",
    });
  });

  it("returns completed when a confirmed mutation fails a parsed test", async () => {
    const rerun = await loadRerun({
      error: { code: 1, stdout: "Tests  0 passed, 1 failed (1)" },
      marker: true,
    });
    await expect(rerun(tempDir, call, { id: "mutated" })).resolves.toEqual({
      kind: "completed",
      testsRun: 1,
      testsFailed: 1,
    });
  });
});
