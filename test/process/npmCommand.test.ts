import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageError } from "../../src/errors.js";
import { resolveNpmCommand } from "../../src/process/npmCommand.js";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  if (platformDescriptor) {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
  if (execPathDescriptor) {
    Object.defineProperty(process, "execPath", execPathDescriptor);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    ...platformDescriptor,
    value: platform,
  });
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "mp npm command "));
  temporaryDirectories.push(directory);
  return directory;
}

describe("resolveNpmCommand", () => {
  it("keeps npm and every argument unchanged on POSIX", () => {
    vi.stubEnv("npm_execpath", "unsupported-launcher.cmd");
    setPlatform("linux");

    expect(resolveNpmCommand(["test", "--silent", "--", "a & b"])).toEqual([
      "npm",
      "test",
      "--silent",
      "--",
      "a & b",
    ]);
  });

  it("runs the verified npm entry point with literal argv on Windows", () => {
    const directory = temporaryDirectory();
    const npmCliPath = join(directory, "npm-cli.js");
    const args = ["test", "--silent", "--", "space path.test.js", "&^%()"];
    writeFileSync(
      npmCliPath,
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
    );
    vi.stubEnv("npm_execpath", npmCliPath);
    setPlatform("win32");

    const command = resolveNpmCommand(args);
    Object.defineProperty(process, "platform", platformDescriptor!);

    expect(command.slice(0, 2)).toEqual([process.execPath, npmCliPath]);
    expect(
      JSON.parse(
        execFileSync(command[0]!, command.slice(1), { encoding: "utf8" }),
      ),
    ).toEqual(args);
  });

  it("uses npm-cli.js beside node when npm_execpath is unavailable", () => {
    const directory = temporaryDirectory();
    const nodePath = join(directory, "node.exe");
    const npmCliPath = join(
      directory,
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    mkdirSync(join(directory, "node_modules", "npm", "bin"), {
      recursive: true,
    });
    writeFileSync(npmCliPath, "");
    vi.stubEnv("npm_execpath", "");
    Object.defineProperty(process, "execPath", {
      ...execPathDescriptor,
      value: nodePath,
    });
    setPlatform("win32");

    expect(resolveNpmCommand(["ci", "--ignore-scripts"])).toEqual([
      nodePath,
      npmCliPath,
      "ci",
      "--ignore-scripts",
    ]);
  });

  it("refuses Windows launcher layouts without a verified npm CLI", () => {
    const directory = temporaryDirectory();
    const nodePath = join(directory, "node.exe");
    vi.stubEnv("npm_execpath", join(directory, "npm.cmd"));
    Object.defineProperty(process, "execPath", {
      ...execPathDescriptor,
      value: nodePath,
    });
    setPlatform("win32");

    expect(() => resolveNpmCommand(["test"])).toThrow(UsageError);
  });
});
