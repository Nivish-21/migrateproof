import Docker from "dockerode";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../errors.js";

const IMAGE = "node:20-slim";
const TMPFS_SIZE_MB = 512;
const MEMORY_HEADROOM_MB = 256;
const MEMORY_LIMIT_BYTES = (TMPFS_SIZE_MB + MEMORY_HEADROOM_MB) * 1024 * 1024;
// The spec names "a hard wall-clock timeout" for the sandbox but never pins a
// duration (unlike the Python bridge's 30s, which the spec's own review round
// left equally open and this plan pinned in Task 17). 20s is this plan's own
// choice, not a spec value — flagged here per this plan's review loop
// (fidelity pass, 2026-09-08) so it isn't mistaken for a spec requirement.
const RUN_TIMEOUT_MS = 20_000;

export const RUN_CONTAINER_SECURITY_OPT = ["no-new-privileges"];

const ENTRYPOINT_SCRIPT = `#!/bin/sh
set -e
cp -r /src/. /workdir/
cp -r /patch/. /workdir/
cd /workdir
npm test
`;

async function waitWithTimeout(
  container: Docker.Container,
  timeoutMs: number,
): Promise<{ timedOut: boolean }> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    container.kill({ signal: "SIGKILL" }).catch(() => {
      // already exited/removed — nothing to do.
    });
  }, timeoutMs);
  try {
    await container.wait();
  } finally {
    clearTimeout(timer);
  }
  return { timedOut };
}

async function readLogs(container: Docker.Container): Promise<string> {
  const buffer = (await container.logs({
    stdout: true,
    stderr: true,
    follow: false,
  })) as unknown as Buffer;
  return buffer.toString("utf-8");
}

async function removeQuietly(
  target: Docker.Container | Docker.Volume,
  opts?: Record<string, unknown>,
) {
  try {
    await target.remove(opts);
  } catch {
    // already removed (e.g. on the timeout path) — not an error.
  }
}

export async function runSandboxed(
  consumerRepoDir: string,
  patchDir: string,
): Promise<{ passed: boolean; log: string }> {
  const docker = new Docker();

  try {
    await docker.ping();
  } catch {
    throw new UsageError("Docker daemon not reachable — is Docker running?");
  }

  try {
    await new Promise<void>((resolve, reject) => {
      docker.pull(IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }
        docker.modem.followProgress(stream, (err2: Error | null) =>
          err2 ? reject(err2) : resolve(),
        );
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`failed to pull ${IMAGE}: ${message}`);
  }

  const volumeName = `migrateproof-sandbox-${randomUUID()}`;
  let prepSrcDir: string | null = null;
  let entrypointDir: string | null = null;
  let prepLog = "";
  let runLog = "";
  let passed = false;

  try {
    const packageJsonPath = join(consumerRepoDir, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new UsageError(
        `consumerRepoDir has no package.json: ${consumerRepoDir}`,
      );
    }

    prepSrcDir = mkdtempSync(join(tmpdir(), "mp-sandbox-prep-src-"));
    const lockfilePath = existsSync(join(consumerRepoDir, "package-lock.json"))
      ? join(consumerRepoDir, "package-lock.json")
      : null;
    cpSync(packageJsonPath, join(prepSrcDir, "package.json"));
    if (lockfilePath) {
      cpSync(lockfilePath, join(prepSrcDir, "package-lock.json"));
    }

    await docker.createVolume({ Name: volumeName });

    entrypointDir = mkdtempSync(join(tmpdir(), "mp-sandbox-entrypoint-"));
    const entrypointPath = join(entrypointDir, "entrypoint.sh");
    writeFileSync(entrypointPath, ENTRYPOINT_SCRIPT, { mode: 0o755 });

    const prepContainer = await docker.createContainer({
      Image: IMAGE,
      Tty: true,
      User: "node",
      WorkingDir: "/prep-src",
      Cmd: ["npm", "ci", "--ignore-scripts"],
      HostConfig: {
        Mounts: [
          {
            Type: "bind",
            Source: prepSrcDir,
            Target: "/prep-src",
            ReadOnly: false,
          },
          {
            Type: "volume",
            Source: volumeName,
            Target: "/prep-src/node_modules",
            ReadOnly: false,
          },
        ],
      },
    });
    try {
      await prepContainer.start();
      const { timedOut: prepTimedOut } = await waitWithTimeout(
        prepContainer,
        RUN_TIMEOUT_MS,
      );
      prepLog = `[prep] ${await readLogs(prepContainer)}`;
      if (prepTimedOut) {
        return { passed: false, log: `${prepLog}\n[prep] timed out` };
      }
    } finally {
      await removeQuietly(prepContainer, { force: true });
    }

    const runContainer = await docker.createContainer({
      Image: IMAGE,
      Tty: true,
      User: "node",
      WorkingDir: "/workdir",
      Cmd: ["/bin/sh", "/entrypoint.sh"],
      HostConfig: {
        Memory: MEMORY_LIMIT_BYTES,
        NetworkMode: "none",
        ReadonlyRootfs: true,
        // uid/gid=1000 match node:20-slim's built-in "node" user (see User:
        // "node" below) — without this the tmpfs mount defaults to root
        // ownership and the entrypoint script's cp into /workdir fails with
        // permission denied, since the container never runs as root.
        Tmpfs: { "/workdir": `size=${TMPFS_SIZE_MB}m,uid=1000,gid=1000` },
        SecurityOpt: RUN_CONTAINER_SECURITY_OPT,
        Mounts: [
          {
            Type: "bind",
            Source: consumerRepoDir,
            Target: "/src",
            ReadOnly: true,
          },
          { Type: "bind", Source: patchDir, Target: "/patch", ReadOnly: true },
          {
            Type: "bind",
            Source: entrypointPath,
            Target: "/entrypoint.sh",
            ReadOnly: true,
          },
          {
            Type: "volume",
            Source: volumeName,
            Target: "/workdir/node_modules",
            ReadOnly: true,
          },
        ],
      },
    });
    try {
      await runContainer.start();
      const { timedOut } = await waitWithTimeout(runContainer, RUN_TIMEOUT_MS);
      runLog = `[run] ${await readLogs(runContainer)}`;
      if (timedOut) {
        return { passed: false, log: `${prepLog}\n${runLog}\ntimed out` };
      }
      const inspection = await runContainer.inspect();
      passed = inspection.State.ExitCode === 0;
    } finally {
      await removeQuietly(runContainer, { force: true });
    }
  } finally {
    await removeQuietly(docker.getVolume(volumeName));
    if (entrypointDir) rmSync(entrypointDir, { recursive: true, force: true });
    if (prepSrcDir) rmSync(prepSrcDir, { recursive: true, force: true });
  }

  return { passed, log: `${prepLog}\n${runLog}` };
}
