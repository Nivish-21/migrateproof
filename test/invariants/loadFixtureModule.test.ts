import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { UsageError } from "../../src/errors.js";
import { loadFixtureModule } from "../../src/invariants/loadFixtureModule.js";

describe("loadFixtureModule", () => {
  it("loads a valid .ts file and returns its default export", async () => {
    const fn = await loadFixtureModule<() => Promise<unknown>>(
      resolve("test/fixtures-support/valid-consumer.ts"),
    );
    const result = await fn();
    expect(result).toEqual({ total: 2750 });
  });

  it("throws UsageError naming the path on a load-time failure", async () => {
    await expect(
      loadFixtureModule(resolve("test/fixtures-support/broken-consumer.ts")),
    ).rejects.toThrow(UsageError);
  });

  it("returns a callable default export from a temporary fixture directory", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "mp-loader-"));
    const file = resolve(directory, "consumer.ts");
    writeFileSync(file, "export default () => ({ total: 2750 });");

    const consumer = await loadFixtureModule<() => { total: number }>(file);

    expect(consumer()).toEqual({ total: 2750 });
    rmSync(directory, { recursive: true });
  });
});
