import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { Command } from "commander";
import { UsageError } from "../errors.js";
import { resolveFixtureDir } from "../fixtures/resolveFixtureDir.js";
import { runReplay, type ReplayResult } from "../replay/runReplay.js";
import { formatHumanReadable } from "./formatReplayOutput.js";

function discoverFixtures(cwd: string): string[] {
  const fixturesRoot = join(cwd, "fixtures");
  if (!existsSync(fixturesRoot)) return [];
  return readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(fixturesRoot, entry.name))
    .filter((directory) => existsSync(join(directory, "fixture.yaml")));
}

function exitCodeFor(results: ReplayResult[]): number {
  if (results.some((result) => !result.passed && result.error === null))
    return 1;
  if (results.some((result) => result.error !== null)) return 2;
  return 0;
}

function errorResult(
  directory: string,
  version: "v1" | "v2",
  error: UsageError,
): ReplayResult {
  const fixture = basename(directory);
  return {
    fixture,
    version,
    passed: false,
    invariant: fixture,
    diff: null,
    error: error.message,
  };
}

export function registerReplayCommand(program: Command): void {
  program
    .command("replay [fixture-dir]")
    .option("--version <version>", "v1 or v2")
    .option("--all", "run every fixture under fixtures/*/fixture.yaml")
    .option("--json", "emit machine-readable output")
    .action(
      async (
        fixtureDirArg: string | undefined,
        options: { version?: string; all?: boolean; json?: boolean },
      ) => {
        if (options.version !== "v1" && options.version !== "v2") {
          console.error("Error: --version must be v1 or v2");
          process.exit(2);
        }
        const version = options.version;
        const cwd = process.cwd();
        let directories: string[];
        if (options.all) {
          directories = discoverFixtures(cwd);
        } else {
          if (!fixtureDirArg) {
            console.error(
              "Error: <fixture-dir> is required unless --all is used",
            );
            process.exit(2);
            return;
          }
          try {
            directories = [resolveFixtureDir(cwd, fixtureDirArg)];
          } catch (error) {
            if (error instanceof UsageError) {
              console.error(`Error: ${error.message}`);
              process.exit(2);
              return;
            }
            throw error;
          }
        }
        const results: ReplayResult[] = [];

        for (const directory of directories) {
          try {
            results.push(await runReplay(directory, version));
          } catch (error) {
            if (error instanceof UsageError && options.all) {
              results.push(errorResult(directory, version, error));
              continue;
            }
            if (error instanceof UsageError) {
              console.error(`Error: ${error.message}`);
              process.exit(2);
            }
            throw error;
          }
        }

        if (options.json) {
          console.log(
            JSON.stringify(options.all ? results : results[0], null, 2),
          );
        } else {
          for (const result of results)
            console.log(formatHumanReadable(result));
          if (options.all) {
            const passed = results.filter((result) => result.passed).length;
            const failed = results.filter(
              (result) => !result.passed && result.error === null,
            ).length;
            const errored = results.filter(
              (result) => result.error !== null,
            ).length;
            console.log(
              `${passed} passed, ${failed} failed, ${errored} errored`,
            );
          }
        }
        process.exit(exitCodeFor(results));
      },
    );
}
