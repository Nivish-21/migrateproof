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
      expect(content).toContain("globalThis.fetch");
      expect(content).toContain("Cannot prove");
      expect(content).toContain("testFiles");
      expect(content).toContain("api.example.com");
      expect(content).not.toContain("api.stripe.com");
      expect(content).toContain("--changes changes.json --json");
      expect(content).toContain("JSON output is on stdout");
      expect(content).toMatch(
        /Usage\/configuration errors may be written to\s+stderr/,
      );
      expect(content).toContain("Do not invent business assertions");
      expect(content).toContain("--fix --patch-backend codex --json");
      expect(content).toContain("the first **Caught** change");
      expect(content).toMatch(/Missed-only results need assertion\s+guidance/);
      expect(content).toContain("compatible-candidate");
      expect(content).toContain("remainingOutcomes");
      expect(content).toContain("npm ci --ignore-scripts");
      expect(content).toMatch(/both accepted and rejected worktrees/i);
      expect(content).toContain(
        "node /absolute/path/to/migrateproof/dist/cli/index.js --changes changes.json --json",
      );
      expect(content).not.toContain("likely mocks above the HTTP layer");
      expect(content).toContain(
        "`protected` (`0`) — every result is **Caught**.",
      );
      expect(content).toContain(
        "`gaps` (`1`) — any result is **Missed**, including when another is **Cannot prove**.",
      );
      expect(content).toContain(
        "`incomplete` (`2`) — no result is **Missed** and at least one is **Cannot prove**.",
      );
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
