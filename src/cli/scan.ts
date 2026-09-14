// src/cli/scan.ts
import { Command } from "commander";
import { UsageError } from "../errors.js";
import { runMutations } from "../mutation/runMutations.js";
import { formatReport, hasGaps } from "../mutation/report.js";

export function registerScanCommand(program: Command): void {
  program
    .command("scan", { isDefault: true })
    .description(
      "run your test suite, mutate its API responses, and report what your tests would not catch",
    )
    .option("--json", "emit machine-readable output")
    .option(
      "--changes <file>",
      "path to a JSON file describing what the API is changing",
    )
    .action(
      async (
        options: { json?: boolean; changes?: string },
        command: Command,
      ) => {
        if (command.args.length > 0) {
          console.error(`error: unknown command '${command.args[0]}'`);
          process.exit(2);
        }
        try {
          const report = await runMutations(process.cwd(), options.changes);
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatReport(report));
        }
        process.exit(hasGaps(report) ? 1 : 0);
      } catch (error) {
        if (error instanceof UsageError) {
          console.error(`Error: ${error.message}`);
          process.exit(2);
        }
        throw error;
      }
    });
}
