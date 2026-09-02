import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FixtureSchema } from "../../src/fixtures/schema.js";
import {
  FixtureValidationError,
  loadFixtureYaml,
} from "../../src/fixtures/schema.js";

describe("FixtureSchema", () => {
  it("accepts a minimal valid fixture with only required fields", () => {
    const result = FixtureSchema.safeParse({
      schemaVersion: 1,
      name: "test-fixture",
      request: { method: "GET", url: "https://api.example.com/v1/orders/123" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a fixture missing schemaVersion", () => {
    const result = FixtureSchema.safeParse({
      name: "test-fixture",
      request: { method: "GET", url: "https://api.example.com/v1/orders/123" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects schemaVersion other than 1", () => {
    const result = FixtureSchema.safeParse({
      schemaVersion: 2,
      name: "test-fixture",
      request: { method: "GET", url: "https://api.example.com/v1/orders/123" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level fields (strict schema)", () => {
    const result = FixtureSchema.safeParse({
      schemaVersion: 1,
      name: "test-fixture",
      request: { method: "GET", url: "https://api.example.com/v1/orders/123" },
      totallyMadeUpField: true,
    });
    expect(result.success).toBe(false);
  });

  it("accepts responses.v1/v2, invariant, and consumer as optional", () => {
    const result = FixtureSchema.safeParse({
      schemaVersion: 1,
      name: "test-fixture",
      request: { method: "GET", url: "https://api.example.com/v1/orders/123" },
      responses: { v1: { status: 200, body: { ok: true } } },
      invariant: "./invariant.ts",
      consumer: "./consumer.ts",
    });
    expect(result.success).toBe(true);
  });
});

describe("loadFixtureYaml", () => {
  it("loads and validates a well-formed fixture.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-fixture-"));
    writeFileSync(
      join(dir, "fixture.yaml"),
      "schemaVersion: 1\nname: t\nrequest:\n  method: GET\n  url: https://x/y\n",
    );
    const fixture = loadFixtureYaml(dir);
    expect(fixture.name).toBe("t");
    rmSync(dir, { recursive: true });
  });

  it("throws FixtureValidationError naming every violation on an invalid fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-fixture-"));
    writeFileSync(join(dir, "fixture.yaml"), "name: t\n");
    expect(() => loadFixtureYaml(dir)).toThrow(FixtureValidationError);
    rmSync(dir, { recursive: true });
  });
});
