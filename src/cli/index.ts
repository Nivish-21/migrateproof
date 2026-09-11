#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { registerCaptureCommand } from "./capture.js";
import { checkNodeVersion } from "./checkNodeVersion.js";
import { registerDiagnoseCommand } from "./diagnose.js";
import { UsageError } from "../errors.js";
import { registerInitCommand } from "./init.js";
import { registerInstallSkillCommand } from "./installSkill.js";
import { registerPatchCommand } from "./patch.js";
import { registerReplayCommand } from "./replay.js";
import { registerScanCommand } from "./scan.js";

try {
  checkNodeVersion(process.version);
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
  throw error;
}

const program = new Command();
program.exitOverride();
registerScanCommand(program);
registerCaptureCommand(program);
registerInitCommand(program);
registerInstallSkillCommand(program);
registerReplayCommand(program);
registerDiagnoseCommand(program);
registerPatchCommand(program);

try {
  program.parse();
} catch (error) {
  if (error instanceof CommanderError) {
    const isHelpOrVersion =
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.version";
    process.exit(isHelpOrVersion ? 0 : 2);
  }
  throw error;
}
