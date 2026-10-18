import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseChangesFile } from "../changes/schema.js";
import { UsageError } from "../errors.js";
import { endpointPathPrefix, selectTestFiles } from "./selectTestFiles.js";

export interface ScanScopeInput {
  projectRoot: string;
  changesPath: string | undefined;
  tests: string[] | undefined;
  allTests: boolean;
}

export interface ScanScope {
  /** Project-relative files; undefined means the whole suite. */
  testFiles: string[] | undefined;
  /** Why these files, for the user. */
  reason: string;
}

const SCOPE_HINT =
  "pass --tests <files> with the tests that call this API (or --all-tests to run the whole suite, which can be slow and heavy)";

function insideProject(projectRoot: string, file: string): string {
  const absolute = resolve(file);
  if (!existsSync(absolute)) {
    throw new UsageError(`--tests file not found: ${file}`);
  }
  const local = relative(realpathSync(projectRoot), realpathSync(absolute));
  if (local === "" || local.startsWith("..") || isAbsolute(local)) {
    throw new UsageError(
      `--tests files must be inside the project: ${file} is not`,
    );
  }
  return local;
}

/**
 * Decides which tests a scan runs. A scan never falls back to the full suite
 * on its own: on a real project that can mean minutes of every CPU core.
 */
export function resolveScanScope(input: ScanScopeInput): ScanScope {
  const { projectRoot, changesPath, tests, allTests } = input;
  if (tests && allTests) {
    throw new UsageError("use either --tests or --all-tests, not both");
  }
  if (tests) {
    return {
      testFiles: tests.map((file) => insideProject(projectRoot, file)),
      reason: "--tests",
    };
  }
  if (allTests) return { testFiles: undefined, reason: "--all-tests" };
  if (!changesPath) {
    throw new UsageError(
      `a scan without --changes needs a scope: pass --tests <files>, or --all-tests to run the whole suite`,
    );
  }

  const changes = parseChangesFile(
    readFileSync(changesPath, "utf-8"),
    changesPath,
  );
  const endpoints = changes.changes.map((change) => change.endpoint);
  const testFiles = selectTestFiles(projectRoot, changes.api, endpoints);
  const searched = [...new Set(endpoints.map(endpointPathPrefix))]
    .map((prefix) => `${changes.api}${prefix}`)
    .join(", ");
  if (testFiles.length === 0) {
    throw new UsageError(
      `no test files reference ${searched}, directly or through a relative import; ${SCOPE_HINT}`,
    );
  }
  return {
    testFiles,
    reason: `selected: these files reference ${searched}`,
  };
}
