import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractInvariants } from "../../src/invariant-extraction/extractInvariants.js";

describe("extractInvariants", () => {
  let dir: string;
  let filePath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mp-extract-"));
    filePath = join(dir, "checkout.test.ts");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("produces a strict-equality predicate for toBe", () => {
    writeFileSync(
      filePath,
      `test("x", () => { expect(result.total).toBe(2750); });`,
    );
    const { generated, skipped } = extractInvariants(filePath, "result");
    expect(skipped).toEqual([]);
    expect(generated).toContain("_r.total === 2750");
    expect(generated).toContain("export default");
  });

  it("produces a structural-equality predicate for toEqual", () => {
    writeFileSync(
      filePath,
      `test("x", () => { expect(result.items).toEqual([1, 2, 3]); });`,
    );
    const { generated } = extractInvariants(filePath, "result");
    expect(generated).toContain("JSON.stringify(_r.items)");
    expect(generated).toContain("JSON.stringify([1, 2, 3])");
  });

  it("reports a custom matcher as skipped, not crashing and not silently dropped", () => {
    writeFileSync(
      filePath,
      `test("x", () => { expect(result.total).toHaveProperty("x"); });`,
    );
    const { generated, skipped } = extractInvariants(filePath, "result");
    expect(generated).toBeNull();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("toHaveProperty");
  });

  it("reports a non-literal argument as skipped", () => {
    writeFileSync(
      filePath,
      `const EXPECTED = 2750;\ntest("x", () => { expect(result.total).toBe(EXPECTED); });`,
    );
    const { generated, skipped } = extractInvariants(filePath, "result");
    expect(generated).toBeNull();
    expect(skipped).toHaveLength(1);
  });

  it("handles bracket-indexed property chains", () => {
    writeFileSync(
      filePath,
      `test("x", () => { expect(result.items[0].price).toBe(10); });`,
    );
    const { generated } = extractInvariants(filePath, "result");
    expect(generated).toContain("_r.items[0].price === 10");
  });

  it("combines multiple in-scope assertions with logical AND", () => {
    writeFileSync(
      filePath,
      `test("x", () => {
        expect(result.total).toBe(2750);
        expect(result.currency).toBe("USD");
      });`,
    );
    const { generated } = extractInvariants(filePath, "result");
    expect(generated).toContain('_r.total === 2750 && _r.currency === "USD"');
  });

  it("ignores assertions rooted at a different identifier than capturedVar", () => {
    writeFileSync(
      filePath,
      `test("x", () => { expect(other.total).toBe(1); });`,
    );
    const { generated, skipped } = extractInvariants(filePath, "result");
    expect(generated).toBeNull();
    expect(skipped).toEqual([]);
  });

  it("returns generated: null and an empty skipped list when there are zero assertions", () => {
    writeFileSync(filePath, `test("x", () => { /* no assertions */ });`);
    const { generated, skipped } = extractInvariants(filePath, "result");
    expect(generated).toBeNull();
    expect(skipped).toEqual([]);
  });
});
