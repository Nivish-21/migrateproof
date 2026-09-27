import { statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { UsageError } from "../errors.js";

function existingNpmCliPath(candidate: string | undefined): string | undefined {
  if (
    candidate === undefined ||
    !isAbsolute(candidate) ||
    basename(candidate) !== "npm-cli.js"
  ) {
    return undefined;
  }
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      ((error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error as NodeJS.ErrnoException).code === "ENOTDIR")
    ) {
      return undefined;
    }
    throw error;
  }
}

export function resolveNpmCommand(args: string[]): string[] {
  if (process.platform !== "win32") return ["npm", ...args];

  const npmCliPath =
    existingNpmCliPath(process.env.npm_execpath) ??
    existingNpmCliPath(
      join(
        dirname(process.execPath),
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      ),
    );
  if (npmCliPath === undefined) {
    throw new UsageError(
      "could not locate npm-cli.js; install npm with Node or use a supported npm installation",
    );
  }
  return [process.execPath, npmCliPath, ...args];
}
