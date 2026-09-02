import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StubPatchBackend } from "../../src/patch/backends/stub.js";
import { runPatch } from "../../src/patch/runPatch.js";
import { runReplay } from "../../src/replay/runReplay.js";

const execFileAsync = promisify(execFile);

describe("checkout-example E2E", () => {
  const fixtureDir = resolve("fixtures/checkout-example");
  let repoRoot: string;
  let worktreeFixtureDir: string;

  beforeAll(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "mp-checkout-example-"));
    worktreeFixtureDir = join(repoRoot, "fixtures/checkout-example");
    cpSync(fixtureDir, worktreeFixtureDir, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: repoRoot });
    await execFileAsync("git", ["add", "."], { cwd: repoRoot });
    await execFileAsync("git", ["commit", "-m", "checkout fixture"], {
      cwd: repoRoot,
    });
  });

  afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

  it("v1 passes and v2 fails with the tax-field diff", async () => {
    const v1 = await runReplay(fixtureDir, "v1");
    expect(v1.passed).toBe(true);

    const v2 = await runReplay(fixtureDir, "v2");
    expect(v2.passed).toBe(false);
    expect(v2.diff).toContainEqual({ field: "tax", from: 250, to: 2.5 });
  });

  it("patch produces a worktree rerun result without mutating the main checkout", async () => {
    const before = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
    });
    const result = await runPatch(
      repoRoot,
      worktreeFixtureDir,
      new StubPatchBackend(),
    );
    expect(typeof result.accepted).toBe("boolean");
    const after = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
    });
    expect(after.stdout).toBe(before.stdout);
  });
});
