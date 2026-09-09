import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCallSites } from "../../../src/ast/ts/findCallSites.js";

describe("findCallSites", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mp-ts-project-"));

    writeFileSync(
      join(root, "client.ts"),
      `export function getOrder(id: string) {
  return fetch("https://api.example.com/v1/orders/" + id);
}
export function getOrderFixed() {
  return fetch("https://api.example.com/v1/orders/123");
}
`,
    );

    writeFileSync(
      join(root, "reexport.ts"),
      `export { getOrderFixed as fetchOrder } from "./client.js";
`,
    );

    mkdirSync(join(root, "consumers"));
    writeFileSync(
      join(root, "consumers", "checkout.ts"),
      `import { getOrderFixed } from "../client.js";

export async function checkout(direct: boolean) {
  if (direct) {
    return getOrderFixed();
  }
  return null;
}

export function topLevelCaller() {
  return getOrderFixed();
}
`,
    );

    writeFileSync(
      join(root, "unrelated.ts"),
      `export function ping() {
  return fetch("https://api.example.com/v1/health");
}
`,
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("finds a direct call, a call through a re-export path, and a call inside a conditional branch", () => {
    const results = findCallSites(
      root,
      "https://api.example.com/v1/orders/123",
    );
    const functions = results.map((r) => r.function).sort();
    expect(functions).toEqual(
      ["checkout", "getOrderFixed", "topLevelCaller"].sort(),
    );
    expect(results.every((r) => r.line > 0)).toBe(true);
    expect(results.some((r) => r.file.endsWith("client.ts"))).toBe(true);
    expect(results.some((r) => r.file.endsWith("checkout.ts"))).toBe(true);
  });

  it("does not match a dynamically-built URL", () => {
    const results = findCallSites(
      root,
      "https://api.example.com/v1/orders/456",
    );
    expect(results).toEqual([]);
  });

  it("does not match an unrelated fixed URL", () => {
    const results = findCallSites(
      root,
      "https://api.example.com/v1/orders/123",
    );
    expect(results.some((r) => r.file.endsWith("unrelated.ts"))).toBe(false);
  });

  it("reports <module scope> for a call with no enclosing function", () => {
    writeFileSync(
      join(root, "topLevel.ts"),
      `import { getOrderFixed } from "./client.js";
getOrderFixed();
`,
    );
    const results = findCallSites(
      root,
      "https://api.example.com/v1/orders/123",
    );
    expect(results.some((r) => r.function === "<module scope>")).toBe(true);
  });
});
