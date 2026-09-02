#!/usr/bin/env node
import { Command } from "commander";
import { registerCaptureCommand } from "./capture.js";
import { registerReplayCommand } from "./replay.js";

const program = new Command();
registerCaptureCommand(program);
registerReplayCommand(program);
program.parse();
