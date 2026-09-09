import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPythonBridge } from "../../../src/ast/py/runPythonBridge.js";
import { UsageError } from "../../../src/errors.js";

describe("runPythonBridge", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mp-py-project-"));
    writeFileSync(
      join(root, "client.py"),
      'def get_order():\n    return call_api("orders/123")\n',
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("returns call sites for a real python3 invocation", async () => {
    const result = await runPythonBridge({
      changedEndpoint: "orders/123",
      sourceRoot: root,
    });
    expect(result.callSites).toHaveLength(1);
    expect(result.callSites[0].function).toBe("get_order");
  });

  it("throws UsageError naming sourceRoot when directory doesn't exist", async () => {
    const missing = join(root, "does-not-exist");
    await expect(
      runPythonBridge({ changedEndpoint: "orders/123", sourceRoot: missing }),
    ).rejects.toThrow(UsageError);
  });

  it("throws a specific UsageError when python3 is missing (ENOENT)", async () => {
    vi.doMock("node:child_process", async () => {
      const actual =
        await vi.importActual<typeof import("node:child_process")>(
          "node:child_process",
        );
      return {
        ...actual,
        execFile: (cmd: string, ...rest: unknown[]) => {
          const cb = rest[rest.length - 1] as (
            err: NodeJS.ErrnoException,
          ) => void;
          const err = new Error(
            "spawn python3 ENOENT",
          ) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          cb(err);
          return {} as never;
        },
      };
    });
    vi.resetModules();
    const { runPythonBridge: bridgeWithMock } =
      await import("../../../src/ast/py/runPythonBridge.js");
    await expect(
      bridgeWithMock({ changedEndpoint: "x", sourceRoot: root }),
    ).rejects.toThrow(/not found on PATH/);
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });
});
