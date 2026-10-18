// src/cli/scan.ts
import { join } from "node:path";
import { Command } from "commander";
import { UsageError } from "../errors.js";
import { resolveTestCommand } from "../mutation/observe.js";
import { runMutations, type ScanOptions } from "../mutation/runMutations.js";
import { resolveScanScope } from "../scope/resolveScanScope.js";
import { exitCodeFor, formatReport } from "../mutation/report.js";
import { runScanFix } from "../patch/runScanFix.js";
import { BACKEND_FACTORIES } from "./patch.js";

interface ScanCliOptions {
  json?: boolean;
  changes?: string;
  fix?: boolean;
  patchBackend: string;
  tests?: string[];
  allTests?: boolean;
}

function fixBackendFactory(
  options: ScanCliOptions,
): (typeof BACKEND_FACTORIES)[string] {
  if (!options.changes)
    throw new UsageError(
      "--fix requires --changes with documented API changes",
    );
  const factory = Object.hasOwn(BACKEND_FACTORIES, options.patchBackend)
    ? BACKEND_FACTORIES[options.patchBackend]
    : undefined;
  if (!factory)
    throw new UsageError(
      `--patch-backend must be one of: ${Object.keys(BACKEND_FACTORIES).join(", ")}`,
    );
  return factory;
}

function scanOptionsFor(
  projectRoot: string,
  options: ScanCliOptions,
): ScanOptions {
  // A missing test script is the more basic problem; report it first.
  resolveTestCommand(join(projectRoot, "package.json"));
  const scope = resolveScanScope({
    projectRoot,
    changesPath: options.changes,
    tests: options.tests,
    allTests: options.allTests === true,
  });
  const progress = (message: string): void => {
    console.error(`[migrateproof] ${message}`);
  };
  progress(
    scope.testFiles === undefined
      ? "running the whole test suite (--all-tests); this can be slow and CPU-heavy"
      : `tests: ${scope.reason}`,
  );
  return { testFiles: scope.testFiles, onProgress: progress };
}

export function registerScanCommand(program: Command): void {
  program
    .command("scan", { isDefault: true })
    .description(
      "run your test suite, mutate its API responses, and report what your tests would not catch",
    )
    .option("--json", "emit machine-readable output")
    .option(
      "--fix",
      "propose a source repair for the first Caught documented change",
    )
    .option(
      "--patch-backend <backend>",
      `one of: ${Object.keys(BACKEND_FACTORIES).join(", ")}`,
      "codex",
    )
    .option(
      "--changes <file>",
      "path to a JSON file describing what the API is changing",
    )
    .option(
      "--tests <files...>",
      "run only these test files (default with --changes: the tests that reference the changed API)",
    )
    .option(
      "--all-tests",
      "run the whole test suite; slow and CPU-heavy on large projects",
    )
    .action(async (options: ScanCliOptions, command: Command) => {
      if (command.args.length > 0) {
        console.error(`error: unknown command '${command.args[0]}'`);
        process.exit(2);
      }
      try {
        const factory = options.fix ? fixBackendFactory(options) : undefined;
        const projectRoot = process.cwd();
        const scanOptions = scanOptionsFor(projectRoot, options);
        if (factory) {
          const result = await runScanFix(
            projectRoot,
            options.changes!,
            factory(),
            scanOptions,
          );
          if (options.json) {
            console.log(
              JSON.stringify({ kind: "scan-fix", ...result }, null, 2),
            );
          } else {
            console.log(
              [
                `${result.status === "compatible-candidate" ? "Compatible candidate" : "Fix rejected"}: ${result.before.change?.endpoint} (${result.before.change?.field})`,
                `Before: ${result.before.status}; ${result.before.testsRun} tests, ${result.before.testsFailed} failures`,
                `After: ${result.after?.status ?? "not verified"}; ${result.after?.testsRun ?? 0} tests, ${result.after?.testsFailed ?? 0} failures`,
                result.reason,
                `Worktree: ${result.worktreeDir}`,
                `Review: git -C ${JSON.stringify(result.worktreeDir)} diff HEAD`,
                `${result.remainingOutcomes.length} other outcome(s) remain; no changes were merged.`,
              ].join("\n"),
            );
          }
          process.exit(result.status === "compatible-candidate" ? 0 : 1);
        }
        const report = await runMutations(
          projectRoot,
          options.changes,
          scanOptions,
        );
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatReport(report));
        }
        process.exit(exitCodeFor(report));
      } catch (error) {
        if (error instanceof UsageError) {
          console.error(`Error: ${error.message}`);
          process.exit(2);
        }
        throw error;
      }
    });
}
