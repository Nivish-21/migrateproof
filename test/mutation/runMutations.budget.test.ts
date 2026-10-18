import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RERUNS_PER_SCAN,
  runMutations,
} from "../../src/mutation/runMutations.js";
import * as observeModule from "../../src/mutation/observe.js";
import * as rerunModule from "../../src/mutation/rerun.js";

const CHANGE_COUNT = MAX_RERUNS_PER_SCAN + 2;

function changesFile(dir: string, count: number): string {
  const path = join(dir, "changes.json");
  writeFileSync(
    path,
    JSON.stringify({
      api: "api.example.com",
      changes: Array.from({ length: count }, (_, i) => ({
        endpoint: "GET /v1/item",
        field: `f${i}`,
        kind: "removed",
      })),
    }),
  );
  return path;
}

function observedItem(): Awaited<ReturnType<typeof observeModule.observe>> {
  const body = Object.fromEntries(
    Array.from({ length: CHANGE_COUNT }, (_, i) => [`f${i}`, i]),
  );
  return {
    calls: [
      {
        method: "GET",
        url: "https://api.example.com/v1/item",
        status: 200,
        body,
        touchingTests: ["/project/test/item.test.ts"],
      },
    ],
    testsRan: 1,
    failingTests: [],
    sawAnyTraffic: true,
    baseline: { passed: true },
  };
}

describe("runMutations cost bounds", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mp-budget-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("runs exactly one scoped baseline and one rerun per change", async () => {
    const observeSpy = vi
      .spyOn(observeModule, "observe")
      .mockResolvedValue(observedItem());
    const rerunSpy = vi
      .spyOn(rerunModule, "rerun")
      .mockResolvedValue({ kind: "completed", testsRun: 1, testsFailed: 1 });

    await runMutations("/project", changesFile(dir, 3), {
      testFiles: ["test/item.test.ts"],
      onProgress: () => {},
    });

    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(observeSpy).toHaveBeenCalledWith("/project", ["test/item.test.ts"]);
    expect(rerunSpy).toHaveBeenCalledTimes(3);
  });

  it("stops rerunning at the per-scan cap and reports the rest as not run", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValue(observedItem());
    const rerunSpy = vi
      .spyOn(rerunModule, "rerun")
      .mockResolvedValue({ kind: "completed", testsRun: 1, testsFailed: 1 });

    const report = await runMutations(
      "/project",
      changesFile(dir, CHANGE_COUNT),
      { testFiles: ["test/item.test.ts"], onProgress: () => {} },
    );

    expect(rerunSpy).toHaveBeenCalledTimes(MAX_RERUNS_PER_SCAN);
    expect(report.outcomes).toHaveLength(CHANGE_COUNT);
    expect(report.outcomes.slice(MAX_RERUNS_PER_SCAN)).toEqual(
      Array.from({ length: 2 }, () =>
        expect.objectContaining({
          status: "incomplete",
          reason: expect.stringContaining("rerun limit"),
        }),
      ),
    );
  });

  it("stops rerunning once the scan's time budget is spent", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValue(observedItem());
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(0); // scan start
    now.mockReturnValue(10 * 60 * 1000); // every later check: budget spent
    const rerunSpy = vi.spyOn(rerunModule, "rerun");

    const report = await runMutations("/project", changesFile(dir, 2), {
      testFiles: ["test/item.test.ts"],
      onProgress: () => {},
    });

    expect(rerunSpy).not.toHaveBeenCalled();
    expect(report.outcomes).toEqual([
      expect.objectContaining({
        status: "incomplete",
        reason: expect.stringContaining("time limit"),
      }),
      expect.objectContaining({ status: "incomplete" }),
    ]);
  });

  it("gives each rerun no more time than the scan has left", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValue(observedItem());
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(0);
    now.mockReturnValue(5 * 60 * 1000 - 20_000); // 20 s left
    const rerunSpy = vi
      .spyOn(rerunModule, "rerun")
      .mockResolvedValue({ kind: "completed", testsRun: 1, testsFailed: 1 });

    await runMutations("/project", changesFile(dir, 1), {
      testFiles: ["test/item.test.ts"],
      onProgress: () => {},
    });

    expect(rerunSpy.mock.calls[0]?.[3]).toBe(20_000);
  });

  it("reports progress for the baseline and each rerun", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValue(observedItem());
    vi.spyOn(rerunModule, "rerun").mockResolvedValue({
      kind: "completed",
      testsRun: 1,
      testsFailed: 1,
    });
    const messages: string[] = [];

    await runMutations("/project", changesFile(dir, 2), {
      testFiles: ["test/item.test.ts"],
      onProgress: (message) => messages.push(message),
    });

    expect(messages).toEqual([
      expect.stringContaining("baseline: 1 test file"),
      expect.stringMatching(/rerun 1\/2: GET .*\/v1\/item f0/),
      expect.stringMatching(/rerun 2\/2: GET .*\/v1\/item f1/),
      expect.stringMatching(/done in \d/),
    ]);
  });

  it("explains a timed-out baseline and suggests scoping", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValue({
      ...observedItem(),
      baseline: {
        passed: false,
        timedOut: true,
        command: "npm test -- --maxWorkers=2",
        timeoutMs: 120_000,
      },
    });

    const report = await runMutations("/project", changesFile(dir, 1), {
      testFiles: undefined,
      onProgress: () => {},
    });

    expect(report.outcomes[0]).toMatchObject({
      status: "incomplete",
      reason: expect.stringMatching(/npm test -- --maxWorkers=2.*2 min limit/),
      nextAction: expect.stringContaining("--tests"),
    });
  });
});
