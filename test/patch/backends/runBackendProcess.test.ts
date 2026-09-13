// test/patch/backends/runBackendProcess.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const { runBackendProcess, resolveBackendTimeoutMs } =
  await import("../../../src/patch/backends/runBackendProcess.js");

describe("runBackendProcess", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("passes a numeric timeout to execFile so the backend cannot hang forever", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      callback(null, { stdout: "ok", stderr: "" });
    });

    await runBackendProcess({
      label: "codex",
      command: "codex",
      args: ["exec"],
      cwd: "/tmp/x",
      timeoutMs: 60_000,
    });

    const [command, args, options] = execFileMock.mock.calls[0];
    expect(command).toBe("codex");
    expect(args).toEqual(["exec"]);
    expect(options).toMatchObject({ timeout: 60_000, cwd: "/tmp/x" });
  });

  it("throws a UsageError naming the backend when it is killed by the timeout", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      const error = new Error("Command failed") as NodeJS.ErrnoException & {
        killed?: boolean;
      };
      error.killed = true;
      callback(error);
    });

    await expect(
      runBackendProcess({
        label: "gemini",
        command: "gemini",
        args: [],
        cwd: "/tmp/x",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/gemini patch backend did not finish within/);
  });

  it("throws a UsageError naming the missing CLI when the binary is not on PATH", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      const error = new Error("spawn opencode ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      callback(error);
    });

    await expect(
      runBackendProcess({
        label: "opencode",
        command: "opencode",
        args: [],
        cwd: "/tmp/x",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/opencode CLI not found on PATH/);
  });
});

describe("resolveBackendTimeoutMs", () => {
  const TEN_MINUTES = 10 * 60 * 1000;

  it("defaults to ten minutes when unset", () => {
    expect(resolveBackendTimeoutMs({})).toBe(TEN_MINUTES);
  });

  it("honours a valid override", () => {
    expect(
      resolveBackendTimeoutMs({ MIGRATEPROOF_BACKEND_TIMEOUT_MS: "30000" }),
    ).toBe(30000);
  });

  // Zero or negative would kill every backend the instant it started, so a
  // bad value must fall back rather than be taken literally.
  it("ignores zero, negative, and non-numeric values", () => {
    expect(
      resolveBackendTimeoutMs({ MIGRATEPROOF_BACKEND_TIMEOUT_MS: "0" }),
    ).toBe(TEN_MINUTES);
    expect(
      resolveBackendTimeoutMs({ MIGRATEPROOF_BACKEND_TIMEOUT_MS: "-5000" }),
    ).toBe(TEN_MINUTES);
    expect(
      resolveBackendTimeoutMs({ MIGRATEPROOF_BACKEND_TIMEOUT_MS: "soon" }),
    ).toBe(TEN_MINUTES);
  });
});
