import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createWorktree } from "../../src/patch/worktree.js";

const execFileAsync = promisify(execFile);

describe("createWorktree", () => {
  let repoRoot: string;

  beforeAll(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "mp-repo-"));
    await execFileAsync("git", ["init"], { cwd: repoRoot });
    await execFileAsync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: repoRoot,
    });
  });

  afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

  it("creates an isolated worktree directory that exists", async () => {
    const { dir, cleanup } = await createWorktree(repoRoot);
    expect(existsSync(dir)).toBe(true);
    await cleanup();
  });

  it("cleanup removes the worktree directory", async () => {
    const { dir, cleanup } = await createWorktree(repoRoot);
    await cleanup();
    expect(existsSync(dir)).toBe(false);
  });
});
