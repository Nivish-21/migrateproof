import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { UsageError } from "../errors.js";
import { loadFixtureYaml } from "../fixtures/schema.js";
import { runReplay } from "../replay/runReplay.js";
import { classifyDiff } from "../semantic-engine/classify.js";
import { buildPrompt, type PatchBackend } from "./types.js";
import { createWorktree } from "./worktree.js";
import { BackendShutdownError } from "./backends/runBackendProcess.js";

const execFileAsync = promisify(execFile);
const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;
const NON_CONSUMER_SOURCE_DIRECTORY_PATTERN =
  /(?:^|\/)(?:__tests__|config|configs|fixtures|test|tests)(?:\/|$)/i;
const CONFIG_SOURCE_FILE_PATTERN =
  /(?:^|[.-])(?:config|configuration)\.[cm]?[jt]sx?$/i;

interface FixtureOracleSnapshot {
  fixture: Buffer;
  invariant: Buffer;
  invariantPath: string;
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function assertCleanWorkingTree(repoRoot: string): Promise<void> {
  let status: string;
  try {
    status = await gitOutput(repoRoot, [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`patch requires a clean git working tree: ${message}`);
  }
  if (status.trim()) {
    throw new UsageError(
      `patch requires a clean working tree in ${repoRoot}; commit or stash changes first`,
    );
  }
}

function matchesSnapshot(path: string, snapshot: Buffer): boolean {
  try {
    return snapshot.equals(readFileSync(path));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function oracleMatches(
  fixtureDir: string,
  snapshot: FixtureOracleSnapshot,
): boolean {
  return (
    matchesSnapshot(join(fixtureDir, "fixture.yaml"), snapshot.fixture) &&
    matchesSnapshot(
      join(fixtureDir, relative(fixtureDir, snapshot.invariantPath)),
      snapshot.invariant,
    )
  );
}

async function baselineIsIntact(
  repoRoot: string,
  worktreeDir: string,
  startingHead: string,
): Promise<boolean> {
  const [repoHead, worktreeHead, repoStatus] = await Promise.all([
    gitOutput(repoRoot, ["rev-parse", "HEAD"]),
    gitOutput(worktreeDir, ["rev-parse", "HEAD"]),
    gitOutput(repoRoot, ["status", "--porcelain", "--untracked-files=all"]),
  ]);
  return (
    repoHead.trim() === startingHead &&
    worktreeHead.trim() === startingHead &&
    !repoStatus.trim()
  );
}

async function changedPaths(
  worktreeDir: string,
  startingHead: string,
): Promise<string[]> {
  const [diff, untracked] = await Promise.all([
    gitOutput(worktreeDir, ["diff", "--name-only", "-z", startingHead, "--"]),
    gitOutput(worktreeDir, ["ls-files", "--others", "-z"]),
  ]);
  return [
    ...new Set([...diff.split("\0"), ...untracked.split("\0")].filter(Boolean)),
  ];
}

function isEligibleConsumerSource(path: string): boolean {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  return (
    isSourceFile(path) &&
    !NON_CONSUMER_SOURCE_DIRECTORY_PATTERN.test(path) &&
    !CONFIG_SOURCE_FILE_PATTERN.test(fileName)
  );
}

function isSourceFile(path: string): boolean {
  return SOURCE_FILE_PATTERN.test(path);
}

function isAllowedConsumerDiff(
  paths: string[],
  fixtureConsumerPath: string,
  fixtureInvariantPath: string,
  tracked: ReadonlySet<string>,
): boolean {
  return (
    paths.length > 0 &&
    fixtureConsumerPath !== fixtureInvariantPath &&
    paths.includes(fixtureConsumerPath) &&
    isSourceFile(fixtureConsumerPath) &&
    !CONFIG_SOURCE_FILE_PATTERN.test(
      fixtureConsumerPath.slice(fixtureConsumerPath.lastIndexOf("/") + 1),
    ) &&
    paths.every(
      (path) =>
        tracked.has(path) &&
        (path === fixtureConsumerPath || isEligibleConsumerSource(path)),
    )
  );
}

export async function runPatch(
  repoRoot: string,
  fixtureDir: string,
  backend: PatchBackend,
): Promise<{ accepted: boolean; rawLog: string; worktreeDir: string | null }> {
  await assertCleanWorkingTree(repoRoot);
  const startingHead = (
    await gitOutput(repoRoot, ["rev-parse", "HEAD"])
  ).trim();
  const tracked = new Set(
    (await gitOutput(repoRoot, ["ls-files", "-z"])).split("\0").filter(Boolean),
  );
  const { dir: worktreeDir, cleanup } = await createWorktree(repoRoot);
  try {
    const worktreeFixtureDir = join(
      worktreeDir,
      relative(repoRoot, fixtureDir),
    );
    const fixture = loadFixtureYaml(worktreeFixtureDir);
    if (!fixture.invariant || !fixture.consumer) {
      throw new UsageError(
        `fixture ${fixtureDir} has no invariant/consumer set — write invariant.ts/consumer.ts and set the field`,
      );
    }
    const oracle: FixtureOracleSnapshot = {
      fixture: readFileSync(join(worktreeFixtureDir, "fixture.yaml")),
      invariantPath: join(worktreeFixtureDir, fixture.invariant),
      invariant: readFileSync(join(worktreeFixtureDir, fixture.invariant)),
    };
    const failureTrace = await runReplay(worktreeFixtureDir, "v2");
    if (
      !(await baselineIsIntact(repoRoot, worktreeDir, startingHead)) ||
      !oracleMatches(worktreeFixtureDir, oracle)
    ) {
      throw new UsageError(
        "patch replay changed the fixture oracle or starting checkout",
      );
    }
    if (failureTrace.passed) {
      throw new UsageError(
        `v2 already passes for ${fixtureDir} — nothing to patch`,
      );
    }
    const fixtureConsumerPath = relative(
      repoRoot,
      join(fixtureDir, fixture.consumer),
    )
      .split(sep)
      .join("/");
    const fixtureInvariantPath = relative(
      repoRoot,
      join(fixtureDir, fixture.invariant),
    )
      .split(sep)
      .join("/");
    const verdicts = classifyDiff(failureTrace.diff);
    const result = await backend.run({
      worktreeDir,
      failureTrace,
      instructions: buildPrompt(failureTrace, verdicts),
    });
    const paths = await changedPaths(worktreeDir, startingHead);
    if (
      !(await baselineIsIntact(repoRoot, worktreeDir, startingHead)) ||
      !oracleMatches(worktreeFixtureDir, oracle) ||
      !isAllowedConsumerDiff(
        paths,
        fixtureConsumerPath,
        fixtureInvariantPath,
        tracked,
      )
    ) {
      await cleanup();
      return { accepted: false, rawLog: result.rawLog, worktreeDir: null };
    }
    const rerun = await runReplay(worktreeFixtureDir, "v2");
    const rerunPaths = await changedPaths(worktreeDir, startingHead);
    if (
      !rerun.passed ||
      !(await baselineIsIntact(repoRoot, worktreeDir, startingHead)) ||
      !oracleMatches(worktreeFixtureDir, oracle) ||
      !isAllowedConsumerDiff(
        rerunPaths,
        fixtureConsumerPath,
        fixtureInvariantPath,
        tracked,
      )
    ) {
      await cleanup();
      return { accepted: false, rawLog: result.rawLog, worktreeDir: null };
    }
    // Accepted: leave the worktree for the human reviewer. It's their job
    // to `git worktree remove` it once they've reviewed and merged the diff.
    return { accepted: true, rawLog: result.rawLog, worktreeDir };
  } catch (error) {
    if (error instanceof BackendShutdownError) {
      throw new UsageError(
        `${error.message} Worktree retained at ${worktreeDir}; stop the backend before removing it.`,
      );
    }
    await cleanup();
    throw error;
  }
}
