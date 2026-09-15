// test/scripts/driftWatch.test.ts
import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  findFixturesWithStagingUrl,
  hasUncommittedChange,
  writeDriftOutput,
} from "../../.github/scripts/driftWatch.js";

const execFileAsync = promisify(execFile);
let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("findFixturesWithStagingUrl", () => {
  it("finds only fixtures with a stagingUrl set", () => {
    dir = mkdtempSync(join(tmpdir(), "mp-drift-unit-"));
    mkdirSync(join(dir, "with-staging"), { recursive: true });
    writeFileSync(
      join(dir, "with-staging", "fixture.yaml"),
      "schemaVersion: 1\nname: a\nrequest:\n  method: GET\n  url: https://x\nstagingUrl: https://staging.example.com/x\n",
    );
    mkdirSync(join(dir, "without-staging"), { recursive: true });
    writeFileSync(
      join(dir, "without-staging", "fixture.yaml"),
      "schemaVersion: 1\nname: b\nrequest:\n  method: GET\n  url: https://y\n",
    );
    const result = findFixturesWithStagingUrl(dir);
    expect(result).toHaveLength(1);
    expect(result[0].stagingUrl).toBe("https://staging.example.com/x");
  });
});

describe("hasUncommittedChange", () => {
  it("reports true only after a tracked file is modified", async () => {
    dir = mkdtempSync(join(tmpdir(), "mp-drift-unit-"));
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "t@example.com"], {
      cwd: dir,
    });
    await execFileAsync("git", ["config", "user.name", "T"], { cwd: dir });
    writeFileSync(join(dir, "f.txt"), "a\n");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
    expect(await hasUncommittedChange("f.txt", dir)).toBe(false);
    writeFileSync(join(dir, "f.txt"), "b\n");
    expect(await hasUncommittedChange("f.txt", dir)).toBe(true);
  });
});

describe("writeDriftOutput", () => {
  it("appends a drift=<bool> line to the given output file", () => {
    dir = mkdtempSync(join(tmpdir(), "mp-drift-unit-"));
    const outputPath = join(dir, "github_output");
    writeFileSync(outputPath, "");
    writeDriftOutput(true, outputPath);
    writeDriftOutput(false, outputPath);
    expect(readFileSync(outputPath, "utf-8")).toBe("drift=true\ndrift=false\n");
  });

  it("does nothing when no output path is given", () => {
    expect(() => writeDriftOutput(true, undefined)).not.toThrow();
  });
});
