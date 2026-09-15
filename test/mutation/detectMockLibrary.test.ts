// test/mutation/detectMockLibrary.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectMockLibraryUsage } from "../../src/mutation/detectMockLibrary.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("detectMockLibraryUsage", () => {
  it("finds a known HTTP-mock package in package.json", () => {
    dir = mkdtempSync(join(tmpdir(), "mp-mocklib-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { nock: "^13.0.0" } }),
    );
    expect(detectMockLibraryUsage(dir)).toEqual({
      library: "nock",
      evidence: '"nock" is listed in package.json',
    });
  });

  it("finds vi.mock of a known HTTP client in a test file", () => {
    dir = mkdtempSync(join(tmpdir(), "mp-mocklib-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({}));
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(
      join(dir, "test", "client.test.ts"),
      'import { vi } from "vitest";\nvi.mock("axios");\n',
    );
    expect(detectMockLibraryUsage(dir)).toEqual({
      library: "axios",
      evidence: `mocked via vi.mock/jest.mock in ${join(dir, "test", "client.test.ts")}`,
    });
  });

  it("returns null when there is no static evidence of mocking", () => {
    dir = mkdtempSync(join(tmpdir(), "mp-mocklib-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.0.0" } }),
    );
    expect(detectMockLibraryUsage(dir)).toBeNull();
  });

  it("skips node_modules when scanning for mocking calls", () => {
    dir = mkdtempSync(join(tmpdir(), "mp-mocklib-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({}));
    mkdirSync(join(dir, "node_modules", "somepkg"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", "somepkg", "x.test.js"),
      'jest.mock("axios");\n',
    );
    expect(detectMockLibraryUsage(dir)).toBeNull();
  });
});
