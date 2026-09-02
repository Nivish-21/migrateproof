import { isAbsolute, relative, resolve } from "node:path";
import { UsageError } from "../errors.js";

export function resolveFixtureDir(cwd: string, fixtureDirArg: string): string {
  const fixturesRoot = resolve(cwd, "fixtures");
  const resolved = resolve(cwd, fixtureDirArg);
  const relativePath = relative(fixturesRoot, resolved);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new UsageError(
      `<fixture-dir> must resolve inside ${fixturesRoot}, got ${resolved}`,
    );
  }
  return resolved;
}
