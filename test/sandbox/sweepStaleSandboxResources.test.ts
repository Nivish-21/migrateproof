import { describe, expect, it, vi } from "vitest";
import {
  SANDBOX_LABEL,
  sweepStaleSandboxResources,
} from "../../src/sandbox/runSandboxed.js";

const NOW = Date.parse("2026-09-12T00:00:00Z");
const ELEVEN_MINUTES_MS = 11 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

type FakeDocker = Parameters<typeof sweepStaleSandboxResources>[0];

function fakeDocker(options: {
  containers?: { Id: string; Created: number }[];
  volumes?: { Name: string; CreatedAt: string }[];
  removeContainer?: () => Promise<void>;
  removeVolume?: () => Promise<void>;
}): {
  docker: FakeDocker;
  removedContainers: string[];
  removedVolumes: string[];
  listContainers: ReturnType<typeof vi.fn>;
} {
  const removedContainers: string[] = [];
  const removedVolumes: string[] = [];
  const listContainers = vi.fn().mockResolvedValue(options.containers ?? []);

  const docker = {
    listContainers,
    listVolumes: vi.fn().mockResolvedValue({ Volumes: options.volumes ?? [] }),
    getContainer: (id: string) => ({
      remove: async () => {
        if (options.removeContainer) await options.removeContainer();
        removedContainers.push(id);
      },
    }),
    getVolume: (name: string) => ({
      remove: async () => {
        if (options.removeVolume) await options.removeVolume();
        removedVolumes.push(name);
      },
    }),
  } as unknown as FakeDocker;

  return { docker, removedContainers, removedVolumes, listContainers };
}

describe("sweepStaleSandboxResources", () => {
  it("removes a labelled container older than the stale threshold", async () => {
    const { docker, removedContainers } = fakeDocker({
      containers: [
        { Id: "stale-abc", Created: (NOW - ELEVEN_MINUTES_MS) / 1000 },
      ],
    });

    const result = await sweepStaleSandboxResources(docker, NOW);

    expect(removedContainers).toEqual(["stale-abc"]);
    expect(result.containersRemoved).toBe(1);
  });

  it("leaves a recent container alone so a concurrent run is never killed", async () => {
    const { docker, removedContainers } = fakeDocker({
      containers: [{ Id: "fresh-abc", Created: (NOW - ONE_MINUTE_MS) / 1000 }],
    });

    const result = await sweepStaleSandboxResources(docker, NOW);

    expect(removedContainers).toEqual([]);
    expect(result.containersRemoved).toBe(0);
  });

  it("removes a labelled volume older than the stale threshold", async () => {
    const { docker, removedVolumes } = fakeDocker({
      volumes: [
        {
          Name: "migrateproof-sandbox-stale",
          CreatedAt: new Date(NOW - ELEVEN_MINUTES_MS).toISOString(),
        },
      ],
    });

    const result = await sweepStaleSandboxResources(docker, NOW);

    expect(removedVolumes).toEqual(["migrateproof-sandbox-stale"]);
    expect(result.volumesRemoved).toBe(1);
  });

  it("leaves a recent volume alone", async () => {
    const { docker, removedVolumes } = fakeDocker({
      volumes: [
        {
          Name: "migrateproof-sandbox-fresh",
          CreatedAt: new Date(NOW - ONE_MINUTE_MS).toISOString(),
        },
      ],
    });

    await sweepStaleSandboxResources(docker, NOW);

    expect(removedVolumes).toEqual([]);
  });

  it("filters on the sandbox label so unrelated containers are never listed", async () => {
    const { docker, listContainers } = fakeDocker({ containers: [] });

    await sweepStaleSandboxResources(docker, NOW);

    expect(listContainers).toHaveBeenCalledWith({
      all: true,
      filters: { label: [SANDBOX_LABEL] },
    });
  });

  it("never throws when the Docker daemon is unreachable — a sweep must not fail the run it precedes", async () => {
    const docker = {
      listContainers: vi.fn().mockRejectedValue(new Error("daemon down")),
      listVolumes: vi.fn(),
      getContainer: vi.fn(),
      getVolume: vi.fn(),
    } as unknown as FakeDocker;

    await expect(sweepStaleSandboxResources(docker, NOW)).resolves.toEqual({
      containersRemoved: 0,
      volumesRemoved: 0,
    });
  });

  it("never throws when an individual removal fails (e.g. volume still in use)", async () => {
    const { docker } = fakeDocker({
      containers: [{ Id: "stuck", Created: (NOW - ELEVEN_MINUTES_MS) / 1000 }],
      removeContainer: async () => {
        throw new Error("volume is in use");
      },
    });

    await expect(
      sweepStaleSandboxResources(docker, NOW),
    ).resolves.toBeDefined();
  });
});
