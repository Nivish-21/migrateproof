// test/patch/backends/runBackendProcess.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const { runBackendProcess } =
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
