#!/usr/bin/env node
import { Command } from "commander";
import { registerCaptureCommand } from "./capture.js";
import { registerPatchCommand } from "./patch.js";
import { registerReplayCommand } from "./replay.js";

const program = new Command();
registerCaptureCommand(program);
registerReplayCommand(program);
registerPatchCommand(program);
program.parse();
