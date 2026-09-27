import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { RunBackendProcessInput } from "../../../src/patch/backends/runBackendProcess.js";
import {
  BackendShutdownError,
  resolveBackendTimeoutMs,
  runBackendProcess,
} from "../../../src/patch/backends/runBackendProcess.js";

const TEN_MINUTES = 10 * 60 * 1000;

function nodeInput(source: string, timeoutMs: number): RunBackendProcessInput {
  return {
    label: "node",
    command: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    timeoutMs,
  };
}

async function expectProcessExit(
  pid: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return;
      }
      throw error;
    }
    await delay(10);
  }
  throw new Error(`child process ${pid} remained alive`);
}

function killProcessIfRunning(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

describe("runBackendProcess", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("runs the argv directly and returns bounded stdout and stderr", async () => {
    const result = await runBackendProcess(
      nodeInput(
        "process.stdout.write('x'.repeat(2_000_000)); process.stderr.write('done')",
        5_000,
      ),
    );
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(2_000_000);
    expect(result.stderr).toBe("done");
  });

  it("passes only platform variables and the selected backend credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-selected-auth");
    vi.stubEnv("CODEX_HOME", "synthetic-codex-profile");
    vi.stubEnv("MIGRATEPROOF_SENTINEL_SECRET", "test-unrelated-secret");
    const result = await runBackendProcess({
      ...nodeInput(
        "process.stdout.write(JSON.stringify({auth: Boolean(process.env.OPENAI_API_KEY), sentinel: Boolean(process.env.MIGRATEPROOF_SENTINEL_SECRET), home: Boolean(process.env.HOME), path: Boolean(process.env.PATH), profile: process.env.CODEX_HOME === 'synthetic-codex-profile'}))",
        5_000,
      ),
      label: "codex",
    });
    expect(result.stdout).toBe(
      JSON.stringify({
        auth: true,
        sentinel: false,
        home: true,
        path: true,
        profile: true,
      }),
    );
  });

  it("does not include raw backend output in a process failure", async () => {
    await expect(
      runBackendProcess(
        nodeInput(
          "process.stdout.write('backend-secret-log'); process.exit(2)",
          5_000,
        ),
      ),
    ).rejects.not.toThrow("backend-secret-log");
  });

  it("rejects a missing executable with a backend-specific UsageError", async () => {
    await expect(
      runBackendProcess({
        label: "opencode",
        command: join(tmpdir(), "missing-migrateproof-backend"),
        args: ["backend-secret-argument"],
        cwd: process.cwd(),
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/opencode CLI not found on PATH/);
  });

  it.each([0.5, 0, -1, Infinity, 2_147_483_648])(
    "rejects direct timeout value %s",
    async (timeoutMs) => {
      await expect(
        runBackendProcess(nodeInput("process.exit(0)", timeoutMs)),
      ).rejects.toThrow(/positive integer/);
    },
  );

  it.each(["backend.cmd", "backend.BAT"])(
    "rejects the Windows batch launcher %s without invoking a shell",
    async (command) => {
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        "platform",
      );
      Object.defineProperty(process, "platform", {
        ...originalPlatform,
        value: "win32",
      });
      try {
        await expect(
          runBackendProcess({
            ...nodeInput("", 1_000),
            command,
            args: ["& echo unexpected"],
          }),
        ).rejects.toThrow(/batch launchers.*native executable.*WSL/);
      } finally {
        if (originalPlatform)
          Object.defineProperty(process, "platform", originalPlatform);
      }
    },
  );

  it("terminates a SIGTERM-ignoring backend before its two-second escape", async () => {
    const startedAt = Date.now();
    await expect(
      runBackendProcess(
        nodeInput(
          "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 2_000)",
          50,
        ),
      ),
    ).rejects.toThrow(/node patch backend did not finish within/);
    expect(Date.now() - startedAt).toBeLessThan(1_500);
  });

  it("terminates and reaps an owned child process tree on timeout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mp-child-test-"));
    const pidPath = join(directory, "child.pid");
    const childSource =
      "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 2_000)";
    const source = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], { stdio: 'ignore' });`,
      `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
      "setInterval(() => {}, 1_000);",
    ].join("\n");
    let childPid: number | null = null;
    try {
      await expect(runBackendProcess(nodeInput(source, 500))).rejects.toThrow(
        /did not finish within/,
      );
      childPid = Number(readFileSync(pidPath, "utf8"));
      await expectProcessExit(childPid, 1_000);
    } finally {
      if (childPid === null && existsSync(pidPath)) {
        childPid = Number(readFileSync(pidPath, "utf8"));
      }
      if (childPid !== null) killProcessIfRunning(childPid);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([false, true])(
    "uses Windows tree termination with graceful success %s",
    async (gracefulSuccess) => {
      const directory = mkdtempSync(join(tmpdir(), "mp-taskkill-test-"));
      const logPath = join(directory, "taskkill.log");
      const taskkillPath = join(directory, "taskkill");
      const taskkillSource = [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}`,
        `if [ "$4" != /F ] && [ ${gracefulSuccess} = false ]; then exit 1; fi`,
        'if [ "$4" = /F ]; then kill -KILL "$2"; else kill -TERM "$2"; fi',
      ].join("\n");
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        "platform",
      );
      writeFileSync(taskkillPath, taskkillSource);
      chmodSync(taskkillPath, 0o755);
      vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);
      Object.defineProperty(process, "platform", {
        ...originalPlatform,
        value: "win32",
      });
      try {
        const failure = await runBackendProcess(
          nodeInput("setTimeout(() => process.exit(0), 5000)", 25),
        ).catch((error: unknown) => error);
        expect(readFileSync(logPath, "utf8")).toMatch(
          gracefulSuccess
            ? /^\/pid \d+ \/T\n$/
            : /\/pid \d+ \/T\n\/pid \d+ \/T \/F\n/,
        );
        expect(failure).toBeInstanceOf(BackendShutdownError);
      } finally {
        if (originalPlatform) {
          Object.defineProperty(process, "platform", originalPlatform);
        }
        rmSync(directory, { recursive: true, force: true });
      }
    },
    15_000,
  );

  it.each(["inherit", "ignore"])(
    "reports uncertain shutdown with a detached child using %s stdio",
    async (stdio) => {
      const directory = mkdtempSync(join(tmpdir(), "mp-escaped-child-"));
      const pidPath = join(directory, "child.pid");
      const source = [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        `const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { detached: true, stdio: '${stdio}' });`,
        `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const started = Date.now();
      try {
        await expect(
          runBackendProcess(nodeInput(source, 500)),
        ).rejects.toBeInstanceOf(BackendShutdownError);
        expect(Date.now() - started).toBeLessThan(2500);
        expect(() =>
          process.kill(Number(readFileSync(pidPath, "utf8")), 0),
        ).not.toThrow();
      } finally {
        if (existsSync(pidPath))
          killProcessIfRunning(Number(readFileSync(pidPath, "utf8")));
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("bounds each Windows taskkill invocation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mp-taskkill-timeout-"));
    const logPath = join(directory, "taskkill.log");
    const taskkillPath = join(directory, "taskkill");
    const originalPlatform = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    );
    writeFileSync(
      taskkillPath,
      [
        `#!${process.execPath}`,
        "const { appendFileSync } = require('node:fs');",
        `const force = process.argv.includes('/F'); appendFileSync(${JSON.stringify(logPath)}, force ? 'force\\n' : 'term\\n');`,
        "if (!force) setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    chmodSync(taskkillPath, 0o755);
    vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);
    Object.defineProperty(process, "platform", {
      ...originalPlatform,
      value: "win32",
    });
    const startedAt = Date.now();
    try {
      await expect(
        runBackendProcess(
          nodeInput("setTimeout(() => process.exit(0), 350)", 25),
        ),
      ).rejects.toThrow(/did not finish within/);
      expect(Date.now() - startedAt).toBeLessThan(9_000);
      expect(readFileSync(logPath, "utf8")).toBe("term\nforce\n");
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);
});

describe("resolveBackendTimeoutMs", () => {
  it("defaults to ten minutes when unset", () => {
    expect(resolveBackendTimeoutMs({})).toBe(TEN_MINUTES);
  });

  it("honours a valid positive integer override", () => {
    expect(
      resolveBackendTimeoutMs({ MIGRATEPROOF_BACKEND_TIMEOUT_MS: "30000" }),
    ).toBe(30_000);
  });

  it.each(["0.5", "0", "-1", "Infinity", "soon", "2147483648"])(
    "defaults for invalid override %s",
    (timeout) => {
      expect(
        resolveBackendTimeoutMs({ MIGRATEPROOF_BACKEND_TIMEOUT_MS: timeout }),
      ).toBe(TEN_MINUTES);
    },
  );
});
