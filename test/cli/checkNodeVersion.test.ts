// test/cli/checkNodeVersion.test.ts
import { describe, expect, it } from "vitest";
import { checkNodeVersion } from "../../src/cli/checkNodeVersion.js";
import { UsageError } from "../../src/errors.js";

describe("checkNodeVersion", () => {
  it("throws UsageError for Node major versions below 22", () => {
    expect(() => checkNodeVersion("v20.19.0")).toThrow(UsageError);
    expect(() => checkNodeVersion("v20.19.0")).toThrow(
      /requires Node\.js >= 22/,
    );
  });

  it("does not throw for Node 22 and above", () => {
    expect(() => checkNodeVersion("v22.0.0")).not.toThrow();
    expect(() => checkNodeVersion("v24.20.0")).not.toThrow();
  });
});
