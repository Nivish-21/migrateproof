import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createWorktree(
  repoRoot: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const parent = mkdtempSync(join(tmpdir(), "mp-worktree-"));
  const dir = join(parent, randomUUID());
  await execFileAsync("git", ["worktree", "add", "--detach", dir], {
    cwd: repoRoot,
  });
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
