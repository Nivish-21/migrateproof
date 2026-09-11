import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const { ClaudeCodePatchBackend } =
  await import("../../../src/patch/backends/claudeCode.js");
const { GeminiCliPatchBackend } =
  await import("../../../src/patch/backends/geminiCli.js");
const { CopilotCliPatchBackend } =
  await import("../../../src/patch/backends/copilotCli.js");
const { OpenCodePatchBackend } =
  await import("../../../src/patch/backends/opencode.js");
const { CursorAgentPatchBackend } =
  await import("../../../src/patch/backends/cursorAgent.js");

function mockSuccess(): void {
  execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
    callback(null, { stdout: "", stderr: "" });
  });
}

describe("new patch backends invoke the right CLI with the right flags", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("Claude Code: claude -p <instructions> --permission-mode bypassPermissions --allowedTools ...", async () => {
    mockSuccess();
    await new ClaudeCodePatchBackend().run({
      worktreeDir: "/tmp/x",
      failureTrace: {} as never,
      instructions: "fix it",
    });
    const [command, args] = execFileMock.mock.calls[0];
    expect(command).toBe("claude");
    expect(args).toEqual([
      "-p",
      "fix it",
      "--permission-mode",
      "bypassPermissions",
      "--allowedTools",
      "Bash,Read,Edit,Write",
    ]);
  });

  it("Gemini CLI: gemini -p <instructions> --yolo", async () => {
    mockSuccess();
    await new GeminiCliPatchBackend().run({
      worktreeDir: "/tmp/x",
      failureTrace: {} as never,
      instructions: "fix it",
    });
    const [command, args] = execFileMock.mock.calls[0];
    expect(command).toBe("gemini");
    expect(args).toEqual(["-p", "fix it", "--yolo"]);
  });

  it("GitHub Copilot CLI: copilot -p <instructions> --allow-all-tools", async () => {
    mockSuccess();
    await new CopilotCliPatchBackend().run({
      worktreeDir: "/tmp/x",
      failureTrace: {} as never,
      instructions: "fix it",
    });
    const [command, args] = execFileMock.mock.calls[0];
    expect(command).toBe("copilot");
    expect(args).toEqual(["-p", "fix it", "--allow-all-tools"]);
  });

  it("OpenCode: opencode run <instructions> --dir <worktreeDir> --auto", async () => {
    mockSuccess();
    await new OpenCodePatchBackend().run({
      worktreeDir: "/tmp/x",
      failureTrace: {} as never,
      instructions: "fix it",
    });
    const [command, args] = execFileMock.mock.calls[0];
    expect(command).toBe("opencode");
    expect(args).toEqual(["run", "fix it", "--dir", "/tmp/x", "--auto"]);
  });

  it("Cursor Agent: cursor-agent -p <instructions>", async () => {
    mockSuccess();
    await new CursorAgentPatchBackend().run({
      worktreeDir: "/tmp/x",
      failureTrace: {} as never,
      instructions: "fix it",
    });
    const [command, args] = execFileMock.mock.calls[0];
    expect(command).toBe("cursor-agent");
    expect(args).toEqual(["-p", "fix it"]);
  });
});
