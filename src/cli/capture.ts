import { Command } from "commander";
import { runCapture } from "../capture/runCapture.js";
import { UsageError } from "../errors.js";
import { resolveFixtureDir } from "../fixtures/resolveFixtureDir.js";

export function registerCaptureCommand(program: Command): void {
  program
    .command("capture <fixture-dir>")
    .requiredOption("--as <version>", "v1 or v2")
    .option(
      "--url <url>",
      "live endpoint to capture from; never use production data",
    )
    .option("--from-file <path>", "static JSON file to capture from")
    .action(
      async (
        fixtureDirArg: string,
        options: { as: string; url?: string; fromFile?: string },
      ) => {
        try {
          const fixtureDir = resolveFixtureDir(process.cwd(), fixtureDirArg);
          if (options.as !== "v1" && options.as !== "v2") {
            throw new UsageError("--as must be v1 or v2");
          }
          if (options.url && options.fromFile) {
            throw new UsageError(
              "--url and --from-file cannot be used together",
            );
          }
          const source = options.url
            ? { url: options.url }
            : options.fromFile
              ? { file: options.fromFile }
              : null;
          if (!source) {
            throw new UsageError("one of --url or --from-file is required");
          }
          await runCapture(fixtureDir, options.as, source);
          process.exit(0);
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
