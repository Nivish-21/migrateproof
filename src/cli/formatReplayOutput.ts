import type { ReplayResult } from "../replay/runReplay.js";

export function formatHumanReadable(result: ReplayResult): string {
  if (result.error !== null) {
    return `⚠ ${result.fixture} (${result.version}) — invariant threw: ${result.error}`;
  }
  if (result.passed) {
    return `✓ ${result.fixture} (${result.version}) — invariant held`;
  }
  const diffLines = (result.diff ?? []).map(
    (entry) => `  ${entry.field}: ${String(entry.from)} → ${String(entry.to)}`,
  );
  return [
    `✗ ${result.fixture} (${result.version}) — invariant failed: ${result.invariant}`,
    ...diffLines,
  ].join("\n");
}
