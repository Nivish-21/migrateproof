import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import yaml from "js-yaml";

const execFileAsync = promisify(execFile);

export function writeDriftOutput(hasDrift, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  appendFileSync(outputPath, `drift=${hasDrift}\n`);
}

export function findFixturesWithStagingUrl(fixturesRoot) {
  if (!existsSync(fixturesRoot)) return [];
  return readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(fixturesRoot, entry.name))
    .filter((dir) => existsSync(join(dir, "fixture.yaml")))
    .map((dir) => ({
      dir,
      stagingUrl:
        yaml.load(readFileSync(join(dir, "fixture.yaml"), "utf-8"))
          ?.stagingUrl ?? null,
    }))
    .filter((entry) => entry.stagingUrl !== null);
}

export async function hasUncommittedChange(path, cwd) {
  try {
    await execFileAsync("git", ["diff", "--quiet", "--", path], { cwd });
    return false;
  } catch {
    return true;
  }
}

async function main() {
  const repoRoot = process.cwd();
  const fixtures = findFixturesWithStagingUrl(join(repoRoot, "fixtures"));
  const drifted = [];

  for (const { dir, stagingUrl } of fixtures) {
    await execFileAsync(
      "npx",
      ["migrateproof", "capture", dir, "--as", "v2", "--url", stagingUrl],
      { cwd: repoRoot },
    );

    const fixtureYamlPath = join(dir, "fixture.yaml");
    if (!(await hasUncommittedChange(fixtureYamlPath, repoRoot))) continue;

    let replayFailed = false;
    let replayOutput = "";
    try {
      const { stdout } = await execFileAsync(
        "npx",
        ["migrateproof", "replay", dir, "--version", "v2", "--json"],
        { cwd: repoRoot },
      );
      replayOutput = stdout;
    } catch (error) {
      replayFailed = true;
      replayOutput = error.stdout ?? String(error);
    }

    if (!replayFailed) {
      // v2 changed but the invariant still holds — nothing worth a PR for.
      await execFileAsync("git", ["checkout", "--", fixtureYamlPath], {
        cwd: repoRoot,
      });
      continue;
    }
    drifted.push({ dir, replayOutput });
  }

  if (drifted.length === 0) {
    console.log("no drift detected");
    writeDriftOutput(false);
    return;
  }
  console.log(`drift detected in ${drifted.length} fixture(s):`);
  for (const { dir, replayOutput } of drifted) {
    console.log(`  ${dir}`);
    console.log(replayOutput);
  }
  writeDriftOutput(true);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
