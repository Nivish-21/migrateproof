// test/cli/init.command.test.ts
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

describe("init command", () => {
  it("scaffolds fixture.yaml, consumer.ts, invariant.ts", async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "mp-init-"));
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          join(repoRoot, "src/cli/index.ts"),
          "init",
          "orders",
          "--method",
          "GET",
          "--url",
          "https://api.example.com/v1/orders/1",
        ],
        { cwd: scratchDir },
      );
      const fixtureDir = join(scratchDir, "fixtures", "orders");
      expect(existsSync(join(fixtureDir, "fixture.yaml"))).toBe(true);
      expect(existsSync(join(fixtureDir, "consumer.ts"))).toBe(true);
      expect(existsSync(join(fixtureDir, "invariant.ts"))).toBe(true);
      expect(
        readFileSync(join(fixtureDir, "fixture.yaml"), "utf-8"),
      ).toContain("https://api.example.com/v1/orders/1");
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a consumer.ts that has real content", async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "mp-init-"));
    const run = () =>
      execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          join(repoRoot, "src/cli/index.ts"),
          "init",
          "orders",
          "--method",
          "GET",
          "--url",
          "https://api.example.com/v1/orders/1",
        ],
        { cwd: scratchDir },
      );
    try {
      await run();
      const consumerPath = join(
        scratchDir,
        "fixtures",
        "orders",
        "consumer.ts",
      );
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        consumerPath,
        "export default async () => ({ real: true });",
      );
      await run();
      throw new Error("expected the second init to reject the edited file");
    } catch (error) {
      const commandError = error as { code: number; stderr: string };
      expect(commandError.code).toBe(2);
      expect(commandError.stderr).toContain("consumer.ts");
      expect(commandError.stderr).toContain("refusing to overwrite");
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
