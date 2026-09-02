import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReplay } from "../../src/replay/runReplay.js";

function writeFixture(
  directory: string,
  options: { invariantThrows?: boolean; v2Passes?: boolean },
): void {
  writeFileSync(
    join(directory, "fixture.yaml"),
    [
      "schemaVersion: 1",
      "name: checkout-total-invariant",
      "request:",
      "  method: GET",
      "  url: https://api.example.com/v1/orders/123",
      "responses:",
      "  v1:",
      "    status: 200",
      "    body: { total: 2750, tax: 250 }",
      "  v2:",
      "    status: 200",
      `    body: { total: 2750, tax: ${options.v2Passes ? 250 : 2.5} }`,
      "invariant: ./invariant.ts",
      "consumer: ./consumer.ts",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "consumer.ts"),
    [
      "export default async function checkout() {",
      "  const response = await fetch('https://api.example.com/v1/orders/123');",
      "  return response.json();",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "invariant.ts"),
    options.invariantThrows
      ? 'export default () => { throw new Error("broken predicate"); };'
      : "export default (result: { total: number; tax: number }) => result.total === 2750 && result.tax === 250;",
  );
}

describe("runReplay", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mp-replay-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true });
  });

  it("passes on v1", async () => {
    writeFixture(directory, {});
    const result = await runReplay(directory, "v1");
    expect(result).toMatchObject({
      passed: true,
      diff: null,
      error: null,
      invariant: "checkout-total-invariant",
    });
  });

  it("fails on v2 with a structural diff naming the changed field", async () => {
    writeFixture(directory, {});
    const result = await runReplay(directory, "v2");
    expect(result.passed).toBe(false);
    expect(result.error).toBeNull();
    expect(result.diff).toContainEqual({ field: "tax", from: 250, to: 2.5 });
  });

  it("reports an errored (not failed) result when the invariant throws", async () => {
    writeFixture(directory, { invariantThrows: true });
    const result = await runReplay(directory, "v1");
    expect(result.passed).toBe(false);
    expect(result.diff).toBeNull();
    expect(result.error).toContain("broken predicate");
  });
});
