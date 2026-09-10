import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../errors.js";

const STUB_MARKER_YAML = "# MIGRATEPROOF_STUB";
const STUB_MARKER_TS = "// MIGRATEPROOF_STUB";

function writeStubIfSafe(path: string, marker: string, content: string): void {
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    if (!existing.startsWith(marker)) {
      throw new UsageError(
        `${path} already has real content (no ${marker} marker on its first line) — refusing to overwrite. Delete it first to re-scaffold.`,
      );
    }
  }
  writeFileSync(path, content);
}

export function registerInitCommand(program: Command): void {
  program
    .command("init <name>")
    .requiredOption("--method <method>", "HTTP method, e.g. GET")
    .requiredOption("--url <url>", "the API endpoint this fixture targets")
    .action((name: string, options: { method: string; url: string }) => {
      try {
        const fixtureDir = join(process.cwd(), "fixtures", name);
        mkdirSync(fixtureDir, { recursive: true });

        writeStubIfSafe(
          join(fixtureDir, "fixture.yaml"),
          STUB_MARKER_YAML,
          [
            STUB_MARKER_YAML,
            "schemaVersion: 1",
            `name: ${name}`,
            "request:",
            `  method: ${options.method}`,
            `  url: ${options.url}`,
            "invariant: ./invariant.ts",
            "consumer: ./consumer.ts",
            "",
          ].join("\n"),
        );

        writeStubIfSafe(
          join(fixtureDir, "consumer.ts"),
          STUB_MARKER_TS,
          [
            STUB_MARKER_TS,
            "// Replace this with the real code path that calls the API — the",
            "// same function your application actually uses, not a simplified",
            "// version. Must be a default-exported, zero-argument async function.",
            "export default async function consumer(): Promise<unknown> {",
            `  const response = await fetch(${JSON.stringify(options.url)});`,
            "  return response.json();",
            "}",
            "",
          ].join("\n"),
        );

        writeStubIfSafe(
          join(fixtureDir, "invariant.ts"),
          STUB_MARKER_TS,
          [
            STUB_MARKER_TS,
            "// Replace this with the real business rule that must hold against",
            "// the consumer's result. Must be a default-exported predicate.",
            "export default (result: unknown): boolean => {",
            "  return result !== undefined;",
            "};",
            "",
          ].join("\n"),
        );

        console.log(`scaffolded ${fixtureDir}`);
        process.exit(0);
      } catch (error) {
        if (error instanceof UsageError) {
          console.error(`Error: ${error.message}`);
          process.exit(2);
        }
        throw error;
      }
    });
}
