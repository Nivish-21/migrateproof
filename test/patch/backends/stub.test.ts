import { describe, expect, it } from "vitest";
import { StubPatchBackend } from "../../../src/patch/backends/stub.js";

describe("StubPatchBackend", () => {
  it("implements PatchBackend.run and returns a result", async () => {
    const backend = new StubPatchBackend();
    const result = await backend.run({
      worktreeDir: "/tmp/x",
      failureTrace: {} as never,
      instructions: "",
    });
    expect(result.appliedFiles).toEqual([]);
  });
});
