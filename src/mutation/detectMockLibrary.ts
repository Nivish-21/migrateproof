// src/mutation/detectMockLibrary.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KNOWN_MOCK_PACKAGES = [
  "nock",
  "axios-mock-adapter",
  "fetch-mock",
  "jest-fetch-mock",
];

const KNOWN_HTTP_CLIENTS = ["axios", "node-fetch", "got", "cross-fetch"];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

export interface MockLibraryHint {
  library: string;
  evidence: string;
}

function findTestFiles(root: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        results.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return results;
}

/**
 * Looks for static evidence that a project mocks HTTP below or above the
 * fetch layer, where MigrateProof's interceptor cannot see traffic. Returns
 * null rather than a low-confidence guess when nothing concrete is found —
 * the caller falls back to its existing generic wording in that case.
 */
export function detectMockLibraryUsage(projectRoot: string): MockLibraryHint | null {
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const name of KNOWN_MOCK_PACKAGES) {
        if (name in deps) {
          return {
            library: name,
            evidence: `"${name}" is listed in package.json`,
          };
        }
      }
    } catch {
      // Malformed package.json — fall through to the file scan.
    }
  }

  for (const file of findTestFiles(projectRoot)) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const client of KNOWN_HTTP_CLIENTS) {
      const pattern = new RegExp(`(vi|jest)\\.mock\\(\\s*["']${client}["']`);
      if (pattern.test(content)) {
        return {
          library: client,
          evidence: `mocked via vi.mock/jest.mock in ${file}`,
        };
      }
    }
  }

  return null;
}
