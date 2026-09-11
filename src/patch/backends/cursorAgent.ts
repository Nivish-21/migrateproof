import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runBackendProcess } from "./runBackendProcess.js";
import type {
  PatchBackend,
  PatchBackendInput,
  PatchBackendResult,
} from "../types.js";

const execFileAsync = promisify(execFile);
const CURSOR_TIMEOUT_MS = 10 * 60 * 1000;

// NOT verified against a real installed binary — cursor-agent was not
// available on the machine this plan was written on. Syntax sourced from
// https://cursor.com/docs/cli/headless: `cursor-agent -p <prompt>`.
// Cursor's own community forum has a reported bug of `-p` hanging
// indefinitely:
// forum.cursor.com/t/cursor-agent-p-print-headless-mode-hangs-indefinitely-and-never-returns/150246
// — runBackendProcess's timeout is the safety net for exactly that
// failure, not optional here. Run `cursor-agent --help` and one live
// smoke test before treating this backend as production-verified.
export class CursorAgentPatchBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    const { stdout, stderr } = await runBackendProcess({
      label: "cursor-agent",
      command: "cursor-agent",
      args: ["-p", input.instructions],
      cwd: input.worktreeDir,
      timeoutMs: CURSOR_TIMEOUT_MS,
    });
    const { stdout: changedFiles } = await execFileAsync(
      "git",
      ["diff", "--name-only"],
      { cwd: input.worktreeDir },
    );
    return {
      appliedFiles: changedFiles.split("\n").filter(Boolean),
      rawLog: `${stdout}\n${stderr}`,
    };
  }
}
