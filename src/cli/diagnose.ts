import { Command } from "commander";
import { UsageError } from "../errors.js";
import { resolveFixtureDir } from "../fixtures/resolveFixtureDir.js";
import { runReplay } from "../replay/runReplay.js";
import { classifyDiff } from "../semantic-engine/classify.js";

export function registerDiagnoseCommand(program: Command): void {
  program
    .command("diagnose <fixture-dir>")
    .option("--json", "emit machine-readable output")
    .action(async (fixtureDirArg: string, options: { json?: boolean }) => {
      try {
        const fixtureDir = resolveFixtureDir(process.cwd(), fixtureDirArg);
        const result = await runReplay(fixtureDir, "v2");
        if (result.passed) {
          if (options.json) {
            console.log(
              JSON.stringify({ passed: true, verdicts: {} }, null, 2),
            );
          } else {
            console.log(
              `✓ ${result.fixture} (v2) — invariant held, nothing to diagnose`,
            );
          }
          process.exit(0);
        }
        const verdicts = classifyDiff(result.diff);
        const verdictsObj = Object.fromEntries(verdicts);
        if (options.json) {
          console.log(
            JSON.stringify({ passed: false, verdicts: verdictsObj }, null, 2),
          );
        } else {
          console.log(`✗ ${result.fixture} (v2) — invariant failed:`);
          for (const [field, verdict] of verdicts) {
            console.log(
              `  ${field}: [${verdict.classification}] ${verdict.explanation}`,
            );
          }
          if (verdicts.size === 0) {
            console.log(
              "  (no field-level diff to classify — check the invariant itself)",
            );
          }
        }
        process.exit(1);
      } catch (error) {
        if (error instanceof UsageError) {
          console.error(`Error: ${error.message}`);
          process.exit(2);
        }
        throw error;
      }
    });
}
