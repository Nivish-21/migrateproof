import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_MD_CONTENT } from "../skill/skillTemplate.js";

export function registerInstallSkillCommand(program: Command): void {
  program.command("install-skill").action(() => {
    const skillDir = join(process.cwd(), ".agents", "skills", "migrateproof");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), SKILL_MD_CONTENT);
    console.log(`wrote ${join(skillDir, "SKILL.md")}`);
    process.exit(0);
  });
}
