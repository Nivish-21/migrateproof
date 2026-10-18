import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  endpointPathPrefix,
  selectTestFiles,
} from "../../src/scope/selectTestFiles.js";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function project(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "mp-select-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

describe("endpointPathPrefix", () => {
  it.each([
    ["GET /api/spaces/{owner}/{name}", "/api/spaces"],
    ["GET /v1/items/{id}", "/v1/items"],
    ["POST /v1/item", "/v1/item"],
    ["GET /{id}", ""],
  ])("takes the static part of %j", (endpoint, expected) => {
    expect(endpointPathPrefix(endpoint)).toBe(expected);
  });
});

describe("selectTestFiles", () => {
  it("selects tests that import a source calling the endpoint, and tests calling it directly", () => {
    const dir = project({
      "src/space.ts":
        "export const f = () => fetch(`https://hub.example.com/api/spaces/${id}`);",
      "src/space.spec.ts": 'import { f } from "./space";',
      "src/direct.test.ts":
        'await fetch("https://hub.example.com/api/spaces/a/b");',
      "src/other.ts": 'fetch("https://hub.example.com/api/models/x");',
      "src/other.spec.ts": 'import "./other";',
      "src/unrelated.spec.ts": 'import "./space-helpers";',
    });

    expect(
      selectTestFiles(dir, "hub.example.com", [
        "GET /api/spaces/{owner}/{name}",
      ]),
    ).toEqual([join("src", "direct.test.ts"), join("src", "space.spec.ts")]);
  });

  it("matches host and path when the URL is built from separate parts", () => {
    const dir = project({
      "lib/client.js": [
        'const BASE = "https://api.example.com";',
        "export const get = (id) => fetch(`${BASE}/v1/items/${id}`);",
      ].join("\n"),
      "test/client.test.js": 'import { get } from "../lib/client.js";',
    });

    expect(
      selectTestFiles(dir, "api.example.com", ["GET /v1/items/{id}"]),
    ).toEqual([join("test", "client.test.js")]);
  });

  it("resolves a .js import specifier to a .ts source", () => {
    const dir = project({
      "src/api.ts": 'fetch("https://api.example.com/v1/item");',
      "src/api.test.ts": 'import { x } from "./api.js";',
    });

    expect(selectTestFiles(dir, "api.example.com", ["GET /v1/item"])).toEqual([
      join("src", "api.test.ts"),
    ]);
  });

  it("ignores node_modules and build output", () => {
    const dir = project({
      "node_modules/pkg/a.test.js": 'fetch("https://api.example.com/v1/item");',
      "dist/a.test.js": 'fetch("https://api.example.com/v1/item");',
    });

    expect(selectTestFiles(dir, "api.example.com", ["GET /v1/item"])).toEqual(
      [],
    );
  });

  it("returns nothing when no file mentions the API", () => {
    const dir = project({ "src/a.test.ts": "expect(1).toBe(1);" });

    expect(selectTestFiles(dir, "api.example.com", ["GET /v1/item"])).toEqual(
      [],
    );
  });
});
