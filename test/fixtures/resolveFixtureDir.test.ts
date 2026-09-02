import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { UsageError } from "../../src/errors.js";
import { resolveFixtureDir } from "../../src/fixtures/resolveFixtureDir.js";

describe("resolveFixtureDir", () => {
  const cwd = "/repo";

  it("resolves a fixture dir inside fixtures/", () => {
    expect(resolveFixtureDir(cwd, "fixtures/checkout-example")).toBe(
      join(cwd, "fixtures/checkout-example"),
    );
  });

  it("rejects a path traversal attempt", () => {
    expect(() => resolveFixtureDir(cwd, "../../etc/whatever")).toThrow(
      UsageError,
    );
  });

  it("rejects an absolute path outside fixtures/", () => {
    expect(() => resolveFixtureDir(cwd, "/tmp/evil")).toThrow(UsageError);
  });
});
