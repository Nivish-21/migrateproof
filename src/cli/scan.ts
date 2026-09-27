// src/cli/scan.ts
import { Command } from "commander";
import { UsageError } from "../errors.js";
import { runMutations } from "../mutation/runMutations.js";
import { exitCodeFor, formatReport } from "../mutation/report.js";
import { runScanFix } from "../patch/runScanFix.js";
import { BACKEND_FACTORIES } from "./patch.js";

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
    .action(
      async (
        options: {
          json?: boolean;
          changes?: string;
          fix?: boolean;
          patchBackend: string;
        },
        command: Command,
      ) => {
        if (command.args.length > 0) {
          console.error(`error: unknown command '${command.args[0]}'`);
          process.exit(2);
        }
        try {
          if (options.fix) {
            if (!options.changes)
              throw new UsageError(
                "--fix requires --changes with documented API changes",
              );
            const factory = Object.hasOwn(
              BACKEND_FACTORIES,
              options.patchBackend,
            )
              ? BACKEND_FACTORIES[options.patchBackend]
              : undefined;
            if (!factory)
              throw new UsageError(
                `--patch-backend must be one of: ${Object.keys(BACKEND_FACTORIES).join(", ")}`,
              );
            const result = await runScanFix(
              process.cwd(),
              options.changes,
              factory(),
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
          const report = await runMutations(process.cwd(), options.changes);
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
      },
    );
}
