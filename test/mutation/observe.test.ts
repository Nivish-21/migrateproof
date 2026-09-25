// test/mutation/observe.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { observe, resolveTestCommand } from "../../src/mutation/observe.js";
import { UsageError } from "../../src/errors.js";

function withPackageJson(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "mp-observe-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(contents));
  return dir;
}

describe("resolveTestCommand", () => {
  it("returns an argv array running the project's own test script", () => {
    const dir = withPackageJson({ scripts: { test: "vitest run" } });
    try {
      expect(resolveTestCommand(join(dir, "package.json"))).toEqual([
        "npm",
        "test",
        "--silent",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws UsageError naming the problem when there is no test script", () => {
    const dir = withPackageJson({ scripts: { build: "tsc" } });
    try {
      expect(() => resolveTestCommand(join(dir, "package.json"))).toThrow(
        UsageError,
      );
      expect(() => resolveTestCommand(join(dir, "package.json"))).toThrow(
        /no "test" script/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws UsageError when package.json does not exist", () => {
    expect(() =>
      resolveTestCommand(join(tmpdir(), "mp-does-not-exist", "package.json")),
    ).toThrow(UsageError);
  });
});

describe("observe", () => {
  it("records a failed baseline test process", async () => {
    const dir = withPackageJson({
      scripts: {
        test: "node -e \"console.log('Tests 0 passed, 1 failed'); process.exit(1)\"",
      },
    });
    mkdirSync(join(dir, "node_modules"));
    try {
      const result = await observe(dir);
      expect(result.baseline).toMatchObject({ passed: false, exitCode: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
