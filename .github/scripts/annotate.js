import { readFileSync } from "node:fs";

export function escapeWorkflowCommand(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function printAnnotations(results) {
  for (const result of results) {
    if (result.error !== null) {
      console.log(
        `::error title=${escapeWorkflowCommand(result.fixture)}::invariant threw: ${escapeWorkflowCommand(result.error)}`,
      );
      continue;
    }
    if (!result.passed) {
      for (const diff of result.diff ?? []) {
        console.log(
          `::error title=${escapeWorkflowCommand(result.fixture)}::invariant failed: ${escapeWorkflowCommand(result.invariant)}; ${escapeWorkflowCommand(diff.field)}: ${escapeWorkflowCommand(String(diff.from))} → ${escapeWorkflowCommand(String(diff.to))}`,
        );
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const raw = JSON.parse(readFileSync(process.argv[2], "utf-8"));
  const results = Array.isArray(raw) ? raw : [raw];
  printAnnotations(results);
}
