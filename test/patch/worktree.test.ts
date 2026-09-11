import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { UsageError } from "../../src/errors.js";
import { createWorktree } from "../../src/patch/worktree.js";

const execFileAsync = promisify(execFile);

describe("createWorktree", () => {
  let repoRoot: string;

  beforeAll(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "mp-repo-"));
    await execFileAsync("git", ["init"], { cwd: repoRoot });
    await execFileAsync("git", ["config", "user.name", "MigrateProof Tests"], {
      cwd: repoRoot,
    });
    await execFileAsync(
      "git",
      ["config", "user.email", "migrateproof-tests@example.invalid"],
      { cwd: repoRoot },
    );
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

  it("cleanup is idempotent after the worktree and parent are gone", async () => {
    const { cleanup } = await createWorktree(repoRoot);
    await cleanup();
    await expect(cleanup()).resolves.toBeUndefined();
  });

  it("cleanup removes the worktree directory", async () => {
    const { dir, cleanup } = await createWorktree(repoRoot);
    const parent = dirname(dir);
    await cleanup();
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(parent)).toBe(false);
  });

  it("throws UsageError and leaves no temp directory when git worktree add fails", async () => {
    const notAGitRepo = mkdtempSync(join(tmpdir(), "mp-not-git-"));
    const isolatedTmp = mkdtempSync(
      join(tmpdir(), "mp-worktree-test-isolation-"),
    );
    const originalTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = isolatedTmp;
    try {
      const before = readdirSync(isolatedTmp).filter((f) =>
        f.startsWith("mp-worktree-"),
      );
      await expect(createWorktree(notAGitRepo)).rejects.toBeInstanceOf(
        UsageError,
      );
      const after = readdirSync(isolatedTmp).filter((f) =>
        f.startsWith("mp-worktree-"),
      );
      expect(after.length).toBe(before.length);
    } finally {
      if (originalTmpdir === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = originalTmpdir;
      }
      rmSync(isolatedTmp, { recursive: true, force: true });
      rmSync(notAGitRepo, { recursive: true, force: true });
    }
  });
});
