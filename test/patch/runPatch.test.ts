import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { StubPatchBackend } from "../../src/patch/backends/stub.js";
import { runPatch } from "../../src/patch/runPatch.js";
import type {
  PatchBackend,
  PatchBackendInput,
  PatchBackendResult,
} from "../../src/patch/types.js";

const execFileAsync = promisify(execFile);

class FixingBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    writeFileSync(
      join(input.worktreeDir, "fixtures/checkout-example/invariant.ts"),
      "export default (_result: unknown) => true;",
    );
    return {
      appliedFiles: ["fixtures/checkout-example/invariant.ts"],
      rawLog: "fixed",
    };
  }
}

describe("runPatch", () => {
  let repoRoot: string;

  beforeAll(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "mp-repo-"));
    const fixtureDir = join(repoRoot, "fixtures/checkout-example");
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, "fixture.yaml"),
      [
        "schemaVersion: 1",
        "name: checkout-total-invariant",
        "request:\n  method: GET\n  url: https://api.example.com/v1/orders/123",
        "responses:\n  v2:\n    status: 200\n    body: { total: 2750, tax: 2.5 }",
        "invariant: ./invariant.ts",
        "consumer: ./consumer.ts",
      ].join("\n"),
    );
    writeFileSync(
      join(fixtureDir, "consumer.ts"),
      "export default async function checkout() { const response = await fetch('https://api.example.com/v1/orders/123'); return response.json(); }",
    );
    writeFileSync(
      join(fixtureDir, "invariant.ts"),
      "export default (result: { tax: number }) => result.tax === 250;",
    );
    await execFileAsync("git", ["init"], { cwd: repoRoot });
    await execFileAsync("git", ["add", "."], { cwd: repoRoot });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoRoot });
  });

  afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

  it("reports accepted: false when the backend does not fix the failure", async () => {
    const result = await runPatch(
      repoRoot,
      join(repoRoot, "fixtures/checkout-example"),
      new StubPatchBackend(),
    );
    expect(result.accepted).toBe(false);
  });

  it("reports accepted: true and never touches the main checkout when the backend fixes it", async () => {
    const result = await runPatch(
      repoRoot,
      join(repoRoot, "fixtures/checkout-example"),
      new FixingBackend(),
    );
    expect(result.accepted).toBe(true);
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
    });
    expect(stdout.trim()).toBe("");
  });
});
