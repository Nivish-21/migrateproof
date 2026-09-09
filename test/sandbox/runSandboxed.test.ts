import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Docker from "dockerode";
import { runSandboxed } from "../../src/sandbox/runSandboxed.js";

const execFileAsync = promisify(execFile);

const dockerAvailable = await execFileAsync("docker", ["info"])
  .then(() => true)
  .catch(() => false);

describe.skipIf(!dockerAvailable)("runSandboxed", () => {
  let consumerRepoDir: string;
  let patchDir: string;

  beforeEach(() => {
    consumerRepoDir = mkdtempSync(join(tmpdir(), "mp-sandbox-consumer-"));
    writeFileSync(
      join(consumerRepoDir, "package.json"),
      JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        scripts: { test: "node test.js" },
      }),
    );
    writeFileSync(
      join(consumerRepoDir, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3 }),
    );
    writeFileSync(
      join(consumerRepoDir, "test.js"),
      "console.log('ok'); process.exit(0);",
    );

    patchDir = mkdtempSync(join(tmpdir(), "mp-sandbox-patch-"));
  });
  afterEach(() => {
    rmSync(consumerRepoDir, { recursive: true, force: true });
    rmSync(patchDir, { recursive: true, force: true });
  });

  it("runs the prep -> volume -> run flow end to end with a real minimal package.json", async () => {
    const result = await runSandboxed(consumerRepoDir, patchDir);
    expect(result.passed).toBe(true);
  }, 60_000);

  it("reports a prep-container failure (invalid package.json) as passed: false, prefixed [prep]", async () => {
    writeFileSync(join(consumerRepoDir, "package.json"), "not json");
    const result = await runSandboxed(consumerRepoDir, patchDir);
    expect(result.passed).toBe(false);
    expect(result.log).toContain("[prep]");
  }, 60_000);

  it("denies a network call from inside the isolated run container, without hanging", async () => {
    writeFileSync(
      join(consumerRepoDir, "test.js"),
      "require('http').get('http://example.com', () => {}).on('error', () => { console.log('blocked'); process.exit(1); });",
    );
    const start = Date.now();
    const result = await runSandboxed(consumerRepoDir, patchDir);
    expect(Date.now() - start).toBeLessThan(20_000);
    expect(result.passed).toBe(false);
  }, 30_000);

  it("kills a process that ignores SIGTERM once the wall-clock timeout fires, leaving no container behind", async () => {
    writeFileSync(
      join(consumerRepoDir, "test.js"),
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    );
    const result = await runSandboxed(consumerRepoDir, patchDir);
    expect(result.passed).toBe(false);
    expect(result.log).toContain("timed out");

    const docker = new Docker();
    const containers = await docker.listContainers({ all: true });
    const leaked = containers.filter(
      (c) => c.Image === "node:20-slim" && c.State === "running",
    );
    expect(leaked).toEqual([]);
  }, 30_000);

  it("denies a privilege-escalation attempt (relies on Docker's default seccomp profile + no-new-privileges)", async () => {
    writeFileSync(
      join(consumerRepoDir, "test.js"),
      "try { process.setuid(0); console.log('escalated'); } catch { console.log('denied'); } process.exit(0);",
    );
    const result = await runSandboxed(consumerRepoDir, patchDir);
    expect(result.log).not.toContain("escalated");
  });
});

describe("runSandboxed HostConfig hardening (structural, no Docker daemon needed)", () => {
  it("never sets seccomp=unconfined and always sets no-new-privileges", async () => {
    const { RUN_CONTAINER_SECURITY_OPT } =
      await import("../../src/sandbox/runSandboxed.js");
    expect(RUN_CONTAINER_SECURITY_OPT).not.toContain("seccomp=unconfined");
    expect(RUN_CONTAINER_SECURITY_OPT).toContain("no-new-privileges");
  });
});
