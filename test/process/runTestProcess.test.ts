import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTestProcess } from "../../src/process/runTestProcess.js";

const posix = process.platform !== "win32";
let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// SIGKILL is delivered asynchronously and the killed process lingers until it
// is reaped, so allow a short window before declaring it a survivor.
async function diesWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !isAlive(pid);
}

// Writes the pid of a 300 s grandchild, then either waits or exits at once.
function suiteSpawningGrandchild(exitImmediately: boolean): string {
  dir = mkdtempSync(join(tmpdir(), "mp-run-test-"));
  const pidFile = join(dir, "grandchild.pid");
  writeFileSync(
    join(dir, "suite.mjs"),
    [
      `import { spawn } from "node:child_process";`,
      `import { writeFileSync } from "node:fs";`,
      `const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore" });`,
      `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
      exitImmediately ? `process.exit(0);` : `setTimeout(() => {}, 300000);`,
    ].join("\n"),
  );
  return pidFile;
}

describe("runTestProcess", () => {
  it("resolves with output when the command succeeds", async () => {
    await expect(
      runTestProcess(process.execPath, ["-e", "console.log('ok')"], {
        cwd: tmpdir(),
        env: process.env,
        timeoutMs: 10_000,
      }),
    ).resolves.toMatchObject({ stdout: "ok\n" });
  });

  it("rejects with the exit code and output when the command fails", async () => {
    await expect(
      runTestProcess(
        process.execPath,
        ["-e", "console.log('partial'); process.exit(3)"],
        { cwd: tmpdir(), env: process.env, timeoutMs: 10_000 },
      ),
    ).rejects.toMatchObject({ code: 3, stdout: "partial\n", killed: false });
  });

  it("rejects with ENOENT when the command does not exist", async () => {
    await expect(
      runTestProcess("migrateproof-no-such-command", [], {
        cwd: tmpdir(),
        env: process.env,
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.runIf(posix)(
    "kills the whole process tree when the time limit is reached",
    async () => {
      const pidFile = suiteSpawningGrandchild(false);
      const started = Date.now();

      await expect(
        runTestProcess(process.execPath, [join(dir!, "suite.mjs")], {
          cwd: dir!,
          env: process.env,
          timeoutMs: 1_000,
        }),
      ).rejects.toMatchObject({ killed: true });

      expect(Date.now() - started).toBeLessThan(5_000);
      const grandchild = Number(readFileSync(pidFile, "utf8"));
      expect(await diesWithin(grandchild, 1_000)).toBe(true);
    },
  );

  it.runIf(posix)(
    "kills processes left behind by a command that exits normally",
    async () => {
      const pidFile = suiteSpawningGrandchild(true);

      await runTestProcess(process.execPath, [join(dir!, "suite.mjs")], {
        cwd: dir!,
        env: process.env,
        timeoutMs: 10_000,
      });

      const grandchild = Number(readFileSync(pidFile, "utf8"));
      expect(await diesWithin(grandchild, 1_000)).toBe(true);
    },
  );
});
