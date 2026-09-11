// test/mutation/observe.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTestCommand } from "../../src/mutation/observe.js";
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
