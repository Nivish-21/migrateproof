import { join, relative } from "node:path";
import { runReplay } from "../replay/runReplay.js";
import { buildPrompt, type PatchBackend } from "./types.js";
import { createWorktree } from "./worktree.js";

export async function runPatch(
  repoRoot: string,
  fixtureDir: string,
  backend: PatchBackend,
): Promise<{ accepted: boolean; rawLog: string }> {
  const failureTrace = await runReplay(fixtureDir, "v2");
  const { dir: worktreeDir, cleanup } = await createWorktree(repoRoot);
  try {
    const result = await backend.run({
      worktreeDir,
      failureTrace,
      instructions: buildPrompt(failureTrace),
    });
    const rerun = await runReplay(
      join(worktreeDir, relative(repoRoot, fixtureDir)),
      "v2",
    );
    return { accepted: rerun.passed, rawLog: result.rawLog };
  } finally {
    await cleanup();
  }
}
