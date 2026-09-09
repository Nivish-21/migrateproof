#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { registerCaptureCommand } from "./capture.js";
import { registerPatchCommand } from "./patch.js";
import { registerReplayCommand } from "./replay.js";

const program = new Command();
program.exitOverride();
registerCaptureCommand(program);
registerReplayCommand(program);
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
