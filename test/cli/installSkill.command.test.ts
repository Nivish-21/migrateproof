// test/cli/installSkill.command.test.ts
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const repoRoot = resolve(".");

describe("install-skill command", () => {
  it("writes .agents/skills/migrateproof/SKILL.md into the cwd", async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "mp-install-skill-"));
    try {
      await execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          join(repoRoot, "src/cli/index.ts"),
          "install-skill",
        ],
        { cwd: scratchDir },
      );
      const skillPath = join(
        scratchDir,
        ".agents",
        "skills",
        "migrateproof",
        "SKILL.md",
      );
      expect(existsSync(skillPath)).toBe(true);
      const content = readFileSync(skillPath, "utf-8");
      expect(content).toContain("migrateproof --changes");
      expect(content).toContain("not yet published to");
      expect(content).toContain("do not hand-edit");
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("overwrites an existing SKILL.md on re-run", async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "mp-install-skill-"));
    const run = () =>
      execFileAsync(
        "node",
        [
          "--import",
          tsxLoader,
          join(repoRoot, "src/cli/index.ts"),
          "install-skill",
        ],
        { cwd: scratchDir },
      );
    try {
      await run();
      await run();
      const skillPath = join(
        scratchDir,
        ".agents",
        "skills",
        "migrateproof",
        "SKILL.md",
      );
      expect(existsSync(skillPath)).toBe(true);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
