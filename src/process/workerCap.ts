// Runners default to one worker per CPU core, which saturates a laptop.
// Two keeps a scan close to the cost of running the same files by hand.
const MAX_WORKERS = 2;

/**
 * Returns runner flags that cap test parallelism, for flags appended after
 * `npm test --`. npm appends them to the end of the script, so only the
 * script's final command receives them. Anything unrecognised gets no flags:
 * passing a flag a command does not understand would break the run.
 *
 * Verified against Vitest 3, Jest 30 and Node's test runner (see plan.md,
 * Phase 0 results).
 */
export function workerCapArgs(testScript: string): string[] {
  const commands = testScript.split(/&&|\|\||;/);
  const last = commands[commands.length - 1]?.trim() ?? "";
  const words = last.split(/\s+/);
  if (words.includes("vitest")) {
    return [`--maxWorkers=${MAX_WORKERS}`, "--minWorkers=1"];
  }
  if (words.includes("jest")) return [`--maxWorkers=${MAX_WORKERS}`];
  if (words[0] === "node" && words.includes("--test")) {
    return [`--test-concurrency=${MAX_WORKERS}`];
  }
  return [];
}
