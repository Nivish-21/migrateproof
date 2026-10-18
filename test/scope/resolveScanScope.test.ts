import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageError } from "../../src/errors.js";
import { resolveScanScope } from "../../src/scope/resolveScanScope.js";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const CHANGES = JSON.stringify({
  api: "api.example.com",
  changes: [{ endpoint: "GET /v1/items/{id}", field: "a", kind: "removed" }],
});

function project(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "mp-scope-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

describe("resolveScanScope", () => {
  it("uses --tests files, relative to the project root", () => {
    const dir = project({ "test/a.test.js": "" });

    expect(
      resolveScanScope({
        projectRoot: dir,
        changesPath: undefined,
        tests: [join(dir, "test", "a.test.js")],
        allTests: false,
      }),
    ).toEqual({ testFiles: [join("test", "a.test.js")], reason: "--tests" });
  });

  it("rejects --tests files that do not exist", () => {
    const dir = project({});

    expect(() =>
      resolveScanScope({
        projectRoot: dir,
        changesPath: undefined,
        tests: [join(dir, "missing.test.js")],
        allTests: false,
      }),
    ).toThrow(/not found/);
  });

  it("rejects --tests files outside the project", () => {
    const dir = project({});
    const outside = mkdtempSync(join(tmpdir(), "mp-outside-"));
    writeFileSync(join(outside, "x.test.js"), "");

    try {
      expect(() =>
        resolveScanScope({
          projectRoot: dir,
          changesPath: undefined,
          tests: [join(outside, "x.test.js")],
          allTests: false,
        }),
      ).toThrow(/inside the project/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects --tests together with --all-tests", () => {
    const dir = project({ "a.test.js": "" });

    expect(() =>
      resolveScanScope({
        projectRoot: dir,
        changesPath: undefined,
        tests: [join(dir, "a.test.js")],
        allTests: true,
      }),
    ).toThrow(UsageError);
  });

  it("runs the full suite only when --all-tests is given", () => {
    const dir = project({});

    expect(
      resolveScanScope({
        projectRoot: dir,
        changesPath: undefined,
        tests: undefined,
        allTests: true,
      }),
    ).toEqual({ testFiles: undefined, reason: "--all-tests" });
  });

  it("selects test files from the changes file when no flag is given", () => {
    const dir = project({
      "changes.json": CHANGES,
      "src/client.ts":
        "export const get = (id) => fetch(`https://api.example.com/v1/items/${id}`);",
      "src/client.test.ts": 'import { get } from "./client";',
      "src/other.test.ts": "",
    });

    expect(
      resolveScanScope({
        projectRoot: dir,
        changesPath: join(dir, "changes.json"),
        tests: undefined,
        allTests: false,
      }),
    ).toEqual({
      testFiles: [join("src", "client.test.ts")],
      reason: "selected: these files reference api.example.com/v1/items",
    });
  });

  it("asks for --tests instead of running everything when nothing matches", () => {
    const dir = project({ "changes.json": CHANGES, "src/a.test.ts": "" });

    expect(() =>
      resolveScanScope({
        projectRoot: dir,
        changesPath: join(dir, "changes.json"),
        tests: undefined,
        allTests: false,
      }),
    ).toThrow(/--tests/);
  });

  it("requires a scope for a scan without a changes file", () => {
    const dir = project({});

    expect(() =>
      resolveScanScope({
        projectRoot: dir,
        changesPath: undefined,
        tests: undefined,
        allTests: false,
      }),
    ).toThrow(/--tests.*--all-tests/);
  });
});
