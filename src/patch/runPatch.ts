import { join, relative } from "node:path";
import { UsageError } from "../errors.js";
import { runReplay } from "../replay/runReplay.js";
import { classifyDiff } from "../semantic-engine/classify.js";
import { buildPrompt, type PatchBackend } from "./types.js";
import { createWorktree } from "./worktree.js";

export async function runPatch(
  repoRoot: string,
  fixtureDir: string,
  backend: PatchBackend,
): Promise<{ accepted: boolean; rawLog: string; worktreeDir: string | null }> {
  const failureTrace = await runReplay(fixtureDir, "v2");
  if (failureTrace.passed) {
    throw new UsageError(
      `v2 already passes for ${fixtureDir} — nothing to patch`,
    );
  }
  const { dir: worktreeDir, cleanup } = await createWorktree(repoRoot);
  try {
    const verdicts = classifyDiff(failureTrace.diff);
    const result = await backend.run({
      worktreeDir,
      failureTrace,
      instructions: buildPrompt(failureTrace, verdicts),
    });
    const rerun = await runReplay(
      join(worktreeDir, relative(repoRoot, fixtureDir)),
      "v2",
    );
    if (!rerun.passed) {
      await cleanup();
      return { accepted: false, rawLog: result.rawLog, worktreeDir: null };
    }
    // Accepted: leave the worktree for the human reviewer. It's their job
    // to `git worktree remove` it once they've reviewed and merged the diff.
    return { accepted: true, rawLog: result.rawLog, worktreeDir };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
