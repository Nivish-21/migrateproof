// test/mutation/runMutations.changes.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMutations } from "../../src/mutation/runMutations.js";
import * as observeModule from "../../src/mutation/observe.js";
import * as rerunModule from "../../src/mutation/rerun.js";
import { UsageError } from "../../src/errors.js";

describe("runMutations with changes file", () => {
  let tmpDir: string;
  let changesPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "migrateproof-test-changes-"));
    changesPath = join(tmpDir, "changes.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("throws UsageError when changes file is not found", async () => {
    await expect(
      runMutations("/fake/project", join(tmpDir, "nonexistent.json")),
    ).rejects.toThrow(UsageError);
  });

  it("lands in unmatched when endpoint is not called by the codebase", async () => {
    writeFileSync(
      changesPath,
      JSON.stringify({
        api: "api.stripe.com",
        source: "https://stripe.com/docs/upgrades",
        changes: [
          {
            endpoint: "GET /v1/refunds",
            field: "reason",
            kind: "removed",
          },
        ],
      }),
    );

    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      calls: [
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { amount: 1000 },
          touchingTests: ["test/charge.test.ts"],
        },
      ],
      testsRan: 1,
      failingTests: [],
      sawAnyTraffic: true,
    });

    const report = await runMutations("/fake/project", changesPath);
    expect(report.mode).toBe("changes");
    expect(report.source).toBe("https://stripe.com/docs/upgrades");
    expect(report.unmatched).toHaveLength(1);
    expect(report.unmatched?.[0]?.endpoint).toBe("GET /v1/refunds");
    expect(report.unmatched?.[0]?.field).toBe("reason");
    expect(report.unmatched?.[0]?.reason).toBe(
      "endpoint not called by this codebase",
    );
  });

  it("lands in unmatched when field is absent from the recorded body", async () => {
    writeFileSync(
      changesPath,
      JSON.stringify({
        api: "api.stripe.com",
        changes: [
          {
            endpoint: "GET /v1/charges/{id}",
            field: "customer.email",
            kind: "removed",
          },
        ],
      }),
    );

    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      calls: [
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { amount: 1000, customer: { id: "cus_1" } },
          touchingTests: ["test/charge.test.ts"],
        },
      ],
      testsRan: 1,
      failingTests: [],
      sawAnyTraffic: true,
    });

    const report = await runMutations("/fake/project", changesPath);
    expect(report.mode).toBe("changes");
    expect(report.unmatched).toHaveLength(1);
    expect(report.unmatched?.[0]?.endpoint).toBe("GET /v1/charges/{id}");
    expect(report.unmatched?.[0]?.field).toBe("customer.email");
    expect(report.unmatched?.[0]?.reason).toContain("not present");
  });

  it("routes matching change with no touching tests to unprotected", async () => {
    writeFileSync(
      changesPath,
      JSON.stringify({
        api: "api.stripe.com",
        changes: [
          {
            endpoint: "GET /v1/charges/{id}",
            field: "amount",
            kind: "unit-change",
            factor: 100,
          },
        ],
      }),
    );

    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      calls: [
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { amount: 1000 },
          touchingTests: [],
        },
      ],
      testsRan: 1,
      failingTests: [],
      sawAnyTraffic: true,
    });

    const report = await runMutations("/fake/project", changesPath);
    expect(report.unprotected).toEqual([
      "GET https://api.stripe.com/v1/charges/ch_123",
    ]);
    expect(report.outcomes).toHaveLength(0);
  });

  it("executes mutation when endpoint matches and field is present", async () => {
    writeFileSync(
      changesPath,
      JSON.stringify({
        api: "api.stripe.com",
        changes: [
          {
            endpoint: "GET /v1/charges/{id}",
            field: "amount",
            kind: "unit-change",
            factor: 100,
          },
        ],
      }),
    );

    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      calls: [
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { amount: 1000 },
          touchingTests: ["test/charge.test.ts"],
        },
      ],
      testsRan: 1,
      failingTests: [],
      sawAnyTraffic: true,
    });

    vi.spyOn(rerunModule, "rerun").mockResolvedValueOnce({
      testsRun: 2,
      testsFailed: 1,
    });

    const report = await runMutations("/fake/project", changesPath);
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]?.classification).toBe("caught");
    expect(report.outcomes[0]?.mutation.after).toBe(100000);
    expect(report.outcomes[0]?.endpoint).toBe(
      "GET https://api.stripe.com/v1/charges/ch_123",
    );
  });
});
