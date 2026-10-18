import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".svelte-kit",
]);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
// Bundled or generated files can be megabytes; consumer code is not.
const MAX_FILE_BYTES = 512 * 1024;
const RELATIVE_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;

/** The endpoint's path up to its first `{param}` segment, without a trailing slash. */
export function endpointPathPrefix(endpoint: string): string {
  const path = endpoint.trim().split(/\s+/).pop() ?? "";
  const staticSegments: string[] = [];
  for (const segment of path.split("/").slice(1)) {
    if (segment.includes("{")) break;
    staticSegments.push(segment);
  }
  return staticSegments.length > 0 ? `/${staticSegments.join("/")}` : "";
}

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        files.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return files;
}

function withoutExtension(path: string): string {
  return path.replace(SOURCE_FILE, "");
}

function relativeImports(file: string, contents: string): string[] {
  return [...contents.matchAll(RELATIVE_IMPORT)].map((match) =>
    withoutExtension(resolve(dirname(file), match[1] ?? "")),
  );
}

/**
 * Picks the test files worth running for a set of documented API changes:
 * tests that mention the API's host and an endpoint's static path, and tests
 * that import, by relative path, a source file that does. It follows one
 * import hop only, and does not follow aliases such as `$lib/` or `@/`.
 *
 * Returns project-relative paths, sorted. An empty result means "could not
 * tell", not "nothing to test"; the caller should ask for explicit files.
 */
export function selectTestFiles(
  projectRoot: string,
  api: string,
  endpoints: string[],
): string[] {
  const prefixes = [...new Set(endpoints.map(endpointPathPrefix))];
  const mentionsEndpoint = (contents: string): boolean =>
    contents.includes(api) &&
    prefixes.some((prefix) => prefix === "" || contents.includes(prefix));

  const selected = new Set<string>();
  const callingSources = new Set<string>();
  const testImports = new Map<string, string[]>();

  for (const file of listSourceFiles(projectRoot)) {
    if (statSync(file).size > MAX_FILE_BYTES) continue;
    const contents = readFileSync(file, "utf8");
    const isTest = TEST_FILE.test(file);
    if (mentionsEndpoint(contents)) {
      if (isTest) selected.add(file);
      else callingSources.add(withoutExtension(file));
    }
    if (isTest) testImports.set(file, relativeImports(file, contents));
  }

  for (const [testFile, imports] of testImports) {
    if (imports.some((imported) => callingSources.has(imported))) {
      selected.add(testFile);
    }
  }

  return [...selected].map((file) => relative(projectRoot, file)).sort();
}
