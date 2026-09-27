import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMutations } from "../../src/mutation/runMutations.js";
import * as observeModule from "../../src/mutation/observe.js";
import * as rerunModule from "../../src/mutation/rerun.js";
import { UsageError } from "../../src/errors.js";

const change = {
  endpoint: "GET /v1/charges/{id}",
  field: "amount",
  kind: "unit-change",
  factor: 100,
};

function observed(
  calls: typeof observeModule.observe extends (
    ...args: never[]
  ) => Promise<infer Result>
    ? Result["calls"]
    : never = [],
): Awaited<ReturnType<typeof observeModule.observe>> {
  return {
    calls,
    testsRan: 1,
    failingTests: [],
    sawAnyTraffic: calls.length > 0,
    baseline: { passed: true },
  };
}

describe("runMutations with changes file", () => {
  let tmpDir: string;
  let changesPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "migrateproof-test-changes-"));
    changesPath = join(tmpDir, "changes.json");
    writeFileSync(
      changesPath,
      JSON.stringify({
        api: "api.stripe.com",
        source: "https://stripe.com/docs/upgrades",
        changes: [change],
      }),
    );
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

  it("returns every requested change as incomplete when the baseline failed", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce({
      ...observed(),
      baseline: { passed: false, exitCode: 1 },
    });
    const rerunSpy = vi.spyOn(rerunModule, "rerun");

    const report = await runMutations("/fake/project", changesPath);

    expect(report.verdict).toBe("incomplete");
    expect(report.outcomes[0]).toMatchObject({
      status: "incomplete",
      change,
      reason: expect.stringContaining("baseline"),
      nextAction: expect.any(String),
    });
    expect(rerunSpy).not.toHaveBeenCalled();
  });

  it("makes an unmatched endpoint incomplete instead of dropping it", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(
      observed([
        {
          method: "GET",
          url: "https://api.stripe.com/v1/refunds/re_123",
          status: 200,
          body: { amount: 1000 },
          touchingTests: ["test/refund.test.ts"],
        },
      ]),
    );

    const report = await runMutations("/fake/project", changesPath);
    expect(report.outcomes).toMatchObject([
      {
        change,
        status: "incomplete",
        reason: "endpoint not called by this codebase",
        nextAction: expect.any(String),
      },
    ]);
  });

  it("makes an absent field incomplete with the observed test files", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(
      observed([
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { customer: { id: "cus_1" } },
          touchingTests: ["test/charge.test.ts"],
        },
      ]),
    );

    const report = await runMutations("/fake/project", changesPath);
    expect(report.outcomes[0]).toMatchObject({
      status: "incomplete",
      testFiles: ["test/charge.test.ts"],
      reason: expect.stringContaining("not present"),
      nextAction: expect.any(String),
    });
  });

  it("makes a matching endpoint with no touching test incomplete", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(
      observed([
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { amount: 1000 },
          touchingTests: [],
        },
      ]),
    );

    const report = await runMutations("/fake/project", changesPath);
    expect(report.outcomes[0]).toMatchObject({
      status: "incomplete",
      testFiles: [],
      reason: expect.stringContaining("no test"),
      nextAction: expect.any(String),
    });
  });

  it("makes no observed traffic incomplete for every requested change", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(observed());

    const report = await runMutations("/fake/project", changesPath);
    expect(report.outcomes[0]).toMatchObject({
      change,
      status: "incomplete",
      nextAction: expect.any(String),
    });
  });

  it("keeps an unconfirmed rerun incomplete", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(
      observed([
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { amount: 1000 },
          touchingTests: ["test/z.test.ts", "test/a.test.ts"],
        },
      ]),
    );
    vi.spyOn(rerunModule, "rerun").mockResolvedValueOnce({
      kind: "incomplete",
      testsRun: 1,
      reason: "the mutation response was not confirmed",
      nextAction: "run the selected test through globalThis.fetch",
    });

    const report = await runMutations("/fake/project", changesPath);
    expect(report.outcomes[0]).toMatchObject({
      status: "incomplete",
      testFiles: ["test/a.test.ts", "test/z.test.ts"],
      nextAction: expect.any(String),
    });
  });

  it("reports a confirmed passing rerun as missed", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(
      observed([
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { amount: 1000 },
          touchingTests: ["test/charge.test.ts"],
        },
      ]),
    );
    vi.spyOn(rerunModule, "rerun").mockResolvedValueOnce({
      kind: "completed",
      testsRun: 2,
      testsFailed: 0,
    });

    const report = await runMutations("/fake/project", changesPath);
    expect(report).toMatchObject({
      verdict: "gaps",
      outcomes: [{ status: "missed", testFiles: ["test/charge.test.ts"] }],
    });
  });

  it("reports a confirmed failing rerun as caught", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(
      observed([
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { amount: 1000 },
          touchingTests: ["test/charge.test.ts"],
        },
      ]),
    );
    vi.spyOn(rerunModule, "rerun").mockResolvedValueOnce({
      kind: "completed",
      testsRun: 2,
      testsFailed: 1,
    });

    const report = await runMutations("/fake/project", changesPath);
    expect(report).toMatchObject({
      verdict: "protected",
      outcomes: [{ status: "caught", testFiles: ["test/charge.test.ts"] }],
    });
  });

  it("does not classify an ambiguous requested response", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(
      observed([
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body: { amount: 1000, id: 1 },
          touchingTests: ["test/charge.test.ts"],
          responseAmbiguous: true,
        },
      ]),
    );
    const rerunSpy = vi.spyOn(rerunModule, "rerun");

    const report = await runMutations("/fake/project", changesPath);

    expect(report.outcomes[0]).toMatchObject({
      status: "incomplete",
      reason: expect.stringContaining("different response bodies"),
      nextAction: expect.any(String),
    });
    expect(rerunSpy).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "zero value scaling",
      requestedChange: { ...change, factor: 100 },
      body: { amount: 0 },
    },
    {
      name: "null to null",
      requestedChange: { ...change, kind: "now-nullable" },
      body: { amount: null },
    },
    {
      name: "same type and value conversion",
      requestedChange: {
        ...change,
        kind: "type-changed",
        "to-type": "string",
      },
      body: { amount: "1000" },
    },
    {
      name: "same enum value",
      requestedChange: { ...change, kind: "new-enum-value", value: "active" },
      body: { amount: "active" },
    },
  ])("leaves $name as incomplete", async ({ requestedChange, body }) => {
    writeFileSync(
      changesPath,
      JSON.stringify({
        api: "api.stripe.com",
        changes: [requestedChange],
      }),
    );
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(
      observed([
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_123",
          status: 200,
          body,
          touchingTests: ["test/charge.test.ts"],
        },
      ]),
    );
    const rerunSpy = vi.spyOn(rerunModule, "rerun");

    const report = await runMutations("/fake/project", changesPath);

    expect(report.outcomes[0]).toMatchObject({
      status: "incomplete",
      reason: expect.stringContaining("does not change"),
      nextAction: expect.any(String),
    });
    expect(rerunSpy).not.toHaveBeenCalled();
  });

  it("aggregates repeated calls conservatively and preserves every source test", async () => {
    vi.spyOn(observeModule, "observe").mockResolvedValueOnce(
      observed([
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_1",
          status: 200,
          body: { amount: 1000 },
          touchingTests: ["test/caught.test.ts"],
        },
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_2",
          status: 200,
          body: { amount: 1000 },
          touchingTests: ["test/incomplete.test.ts"],
        },
        {
          method: "GET",
          url: "https://api.stripe.com/v1/charges/ch_3",
          status: 200,
          body: { amount: 1000 },
          touchingTests: ["test/missed.test.ts"],
        },
      ]),
    );
    vi.spyOn(rerunModule, "rerun")
      .mockResolvedValueOnce({
        kind: "completed",
        testsRun: 1,
        testsFailed: 1,
      })
      .mockResolvedValueOnce({
        kind: "incomplete",
        testsRun: 1,
        reason: "the mutation response was not confirmed",
        nextAction: "run the selected test through globalThis.fetch",
      })
      .mockResolvedValueOnce({
        kind: "completed",
        testsRun: 1,
        testsFailed: 0,
      });

    const report = await runMutations("/fake/project", changesPath);
    expect(report.outcomes).toMatchObject([
      {
        status: "missed",
        testFiles: [
          "test/caught.test.ts",
          "test/incomplete.test.ts",
          "test/missed.test.ts",
        ],
      },
    ]);
  });
});
