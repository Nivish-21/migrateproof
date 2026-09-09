import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { UsageError } from "../errors.js";

const execFileAsync = promisify(execFile);

export async function createWorktree(
  repoRoot: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const parent = mkdtempSync(join(tmpdir(), "mp-worktree-"));
  const dir = join(parent, randomUUID());
  try {
    await execFileAsync("git", ["worktree", "add", "--detach", dir], {
      cwd: repoRoot,
    });
  } catch (error) {
    rmSync(parent, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `failed to create git worktree: ${message} (common causes: a dirty working tree, git not installed, or ${repoRoot} not being a git repository)`,
    );
  }
  let cleaned = false;
  return {
    dir,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      try {
        await execFileAsync("git", ["worktree", "remove", "--force", dir], {
          cwd: repoRoot,
        });
        rmdirSync(parent);
      } catch (error) {
        cleaned = false;
        throw error;
      }
    },
  };
}
