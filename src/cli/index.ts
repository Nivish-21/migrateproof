#!/usr/bin/env node
import { Command } from "commander";
import { registerCaptureCommand } from "./capture.js";

const program = new Command();
registerCaptureCommand(program);
program.parse();
