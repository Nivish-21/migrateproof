import { UsageError } from "../errors.js";

const MIN_NODE_MAJOR = 22;

export function checkNodeVersion(versionString: string): void {
  const match = /^v?(\d+)\./.exec(versionString);
  const major = match ? Number(match[1]) : NaN;
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    throw new UsageError(
      `MigrateProof requires Node.js >= ${MIN_NODE_MAJOR} (found ${versionString}).`,
    );
  }
}
