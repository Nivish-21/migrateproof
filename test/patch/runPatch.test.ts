import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { UsageError } from "../../src/errors.js";
import { StubPatchBackend } from "../../src/patch/backends/stub.js";
import { runPatch } from "../../src/patch/runPatch.js";
import { BackendShutdownError } from "../../src/patch/backends/runBackendProcess.js";
import type {
  PatchBackend,
  PatchBackendInput,
  PatchBackendResult,
} from "../../src/patch/types.js";

const execFileAsync = promisify(execFile);

class FixingBackend implements PatchBackend {
  constructor(private readonly stageChanges = false) {}

  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    writeFileSync(
      join(input.worktreeDir, "fixtures/checkout-example/consumer.ts"),
      "export default async function checkout() { const response = await fetch('https://api.example.com/v1/orders/123'); const order = await response.json() as { tax: number }; return { ...order, tax: order.tax * 100 }; }",
    );
    if (this.stageChanges) {
      await execFileAsync(
        "git",
        ["add", "fixtures/checkout-example/consumer.ts"],
        { cwd: input.worktreeDir },
      );
    }
    return {
      appliedFiles: [],
      rawLog: "fixed",
    };
  }
}

class NonSourceChangeBackend extends FixingBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    const result = await super.run(input);
    writeFileSync(join(input.worktreeDir, "README.md"), "unrequested change");
    return result;
  }
}

class UnrelatedSourceBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    mkdirSync(join(input.worktreeDir, "src"), { recursive: true });
    writeFileSync(join(input.worktreeDir, "src/unrelated.ts"), "export {};\n");
    return { appliedFiles: [], rawLog: "unrelated source change" };
  }
}

class CommittingBackend extends FixingBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    const result = await super.run(input);
    await execFileAsync(
      "git",
      ["add", "fixtures/checkout-example/consumer.ts"],
      {
        cwd: input.worktreeDir,
      },
    );
    await execFileAsync("git", ["commit", "-m", "backend commit"], {
      cwd: input.worktreeDir,
    });
    return result;
  }
}

class MutatingDuringReplayBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    const invariantPath = join(
      input.worktreeDir,
      "fixtures/checkout-example/invariant.ts",
    );
    writeFileSync(
      join(input.worktreeDir, "fixtures/checkout-example/consumer.ts"),
      `import { writeFileSync } from "node:fs"; export default async function checkout() { writeFileSync(${JSON.stringify(invariantPath)}, "export default (_result: unknown) => true;"); const response = await fetch('https://api.example.com/v1/orders/123'); const order = await response.json() as { tax: number }; return { ...order, tax: order.tax * 100 }; }`,
    );
    return { appliedFiles: [], rawLog: "fixed" };
  }
}

class TamperingBackend implements PatchBackend {
  constructor(private readonly tamper: (worktreeDir: string) => void) {}

  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    this.tamper(input.worktreeDir);
    return { appliedFiles: [], rawLog: "tampered" };
  }
}

describe("runPatch", () => {
  let repoRoot: string;
  let baseCommit: string;

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
    await execFileAsync("git", ["config", "user.name", "MigrateProof Tests"], {
      cwd: repoRoot,
    });
    await execFileAsync(
      "git",
      ["config", "user.email", "migrateproof-tests@example.invalid"],
      { cwd: repoRoot },
    );
    await execFileAsync("git", ["add", "."], { cwd: repoRoot });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoRoot });
    baseCommit = (
      await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
      })
    ).stdout.trim();
  });

  beforeEach(async () => {
    await execFileAsync("git", ["reset", "--hard", baseCommit], {
      cwd: repoRoot,
    });
    await execFileAsync("git", ["clean", "-fd"], { cwd: repoRoot });
  });

  afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

  it("reports accepted: false and removes the worktree when the backend does not fix the failure", async () => {
    const result = await runPatch(
      repoRoot,
      join(repoRoot, "fixtures/checkout-example"),
      new StubPatchBackend(),
    );
    expect(result.accepted).toBe(false);
    expect(result.worktreeDir).toBeNull();
  });

  it("rejects an ignored helper that is missing from the review diff", async () => {
    writeFileSync(join(repoRoot, ".gitignore"), ".generated/\n");
    await execFileAsync("git", ["add", ".gitignore"], { cwd: repoRoot });
    await execFileAsync("git", ["commit", "-m", "ignore generated helpers"], {
      cwd: repoRoot,
    });
    const backend: PatchBackend = {
      async run(input) {
        await new FixingBackend().run(input);
        mkdirSync(join(input.worktreeDir, ".generated"));
        writeFileSync(
          join(input.worktreeDir, ".generated", "helper.ts"),
          "export const scale = 100;\n",
        );
        const consumerPath = join(
          input.worktreeDir,
          "fixtures/checkout-example/consumer.ts",
        );
        writeFileSync(
          consumerPath,
          `import { scale } from '../../.generated/helper.ts';\n${readFileSync(consumerPath, "utf8").replace("order.tax * 100", "order.tax * scale")}`,
        );
        return { appliedFiles: [], rawLog: "" };
      },
    };
    const result = await runPatch(
      repoRoot,
      join(repoRoot, "fixtures/checkout-example"),
      backend,
    );
    try {
      expect(result.accepted).toBe(false);
    } finally {
      if (result.worktreeDir)
        await execFileAsync(
          "git",
          ["worktree", "remove", "--force", result.worktreeDir],
          { cwd: repoRoot },
        );
    }
  });

  it("retains the worktree when backend shutdown cannot be confirmed", async () => {
    let candidate: string | undefined;
    try {
      await expect(
        runPatch(repoRoot, join(repoRoot, "fixtures/checkout-example"), {
          async run(input) {
            candidate = input.worktreeDir;
            throw new BackendShutdownError("shutdown could not be confirmed");
          },
        }),
      ).rejects.toThrow("Worktree retained");
      expect(candidate).toBeDefined();
      expect(existsSync(candidate!)).toBe(true);
    } finally {
      if (candidate && existsSync(candidate))
        await execFileAsync(
          "git",
          ["worktree", "remove", "--force", candidate],
          { cwd: repoRoot },
        );
    }
  });

  it.each([false, true])(
    "accepts a real consumer repair and retains its %s-staged diff",
    async (stageChanges) => {
      const fixtureDir = join(repoRoot, "fixtures/checkout-example");
      const fixtureBefore = readFileSync(join(fixtureDir, "fixture.yaml"));
      const invariantBefore = readFileSync(join(fixtureDir, "invariant.ts"));
      const result = await runPatch(
        repoRoot,
        fixtureDir,
        new FixingBackend(stageChanges),
      );
      try {
        expect(result.accepted).toBe(true);
        expect(result.worktreeDir).not.toBeNull();
        if (result.worktreeDir === null) return;
        expect(existsSync(result.worktreeDir!)).toBe(true);
        const { stdout: diff } = await execFileAsync(
          "git",
          ["diff", "HEAD", "--", "fixtures/checkout-example/consumer.ts"],
          { cwd: result.worktreeDir! },
        );
        expect(diff).toContain("order.tax * 100");
        expect(readFileSync(join(fixtureDir, "fixture.yaml"))).toEqual(
          fixtureBefore,
        );
        expect(readFileSync(join(fixtureDir, "invariant.ts"))).toEqual(
          invariantBefore,
        );
        const { stdout } = await execFileAsync(
          "git",
          ["status", "--porcelain"],
          { cwd: repoRoot },
        );
        expect(stdout.trim()).toBe("");
      } finally {
        if (result.worktreeDir !== null) {
          await execFileAsync(
            "git",
            ["worktree", "remove", "--force", result.worktreeDir],
            { cwd: repoRoot },
          );
          rmSync(join(result.worktreeDir, ".."), {
            recursive: true,
            force: true,
          });
        }
      }
    },
  );

  it.each([
    [
      "fixture response",
      (worktreeDir: string) =>
        writeFileSync(
          join(worktreeDir, "fixtures/checkout-example/fixture.yaml"),
          readFileSync(
            join(worktreeDir, "fixtures/checkout-example/fixture.yaml"),
            "utf8",
          ).replace("tax: 2.5", "tax: 250"),
        ),
    ],
    [
      "invariant",
      (worktreeDir: string) =>
        writeFileSync(
          join(worktreeDir, "fixtures/checkout-example/invariant.ts"),
          "export default (_result: unknown) => true;",
        ),
    ],
    [
      "deleted invariant",
      (worktreeDir: string) =>
        unlinkSync(join(worktreeDir, "fixtures/checkout-example/invariant.ts")),
    ],
  ])("rejects backend tampering with the %s oracle", async (_name, tamper) => {
    const fixtureDir = join(repoRoot, "fixtures/checkout-example");
    const fixtureBefore = readFileSync(join(fixtureDir, "fixture.yaml"));
    const invariantBefore = readFileSync(join(fixtureDir, "invariant.ts"));
    const result = await runPatch(
      repoRoot,
      fixtureDir,
      new TamperingBackend(tamper),
    );
    expect(result.accepted).toBe(false);
    expect(result.worktreeDir).toBeNull();
    expect(readFileSync(join(fixtureDir, "fixture.yaml"))).toEqual(
      fixtureBefore,
    );
    expect(readFileSync(join(fixtureDir, "invariant.ts"))).toEqual(
      invariantBefore,
    );
  });

  it.each(["unstaged", "staged", "untracked"])(
    "rejects a %s checkout before replay or backend execution",
    async (change) => {
      let backendCalled = false;
      const backend: PatchBackend = {
        async run() {
          backendCalled = true;
          return { appliedFiles: [], rawLog: "" };
        },
      };
      if (change === "untracked") {
        writeFileSync(join(repoRoot, "untracked.txt"), "local data");
      } else {
        const fixturePath = join(
          repoRoot,
          "fixtures/checkout-example/fixture.yaml",
        );
        writeFileSync(
          fixturePath,
          readFileSync(fixturePath, "utf8").replace("tax: 2.5", "tax: 250"),
        );
        if (change === "staged") {
          await execFileAsync(
            "git",
            ["add", "fixtures/checkout-example/fixture.yaml"],
            {
              cwd: repoRoot,
            },
          );
        }
      }
      const error = await runPatch(
        repoRoot,
        join(repoRoot, "fixtures/checkout-example"),
        backend,
      ).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(UsageError);
      if (error instanceof UsageError) {
        expect(error.message).toContain("clean working tree");
      }
      expect(backendCalled).toBe(false);
    },
  );

  it("rejects a dirty passing fixture rather than using a different HEAD fixture with a no-op backend", async () => {
    let backendCalled = false;
    const backend: PatchBackend = {
      async run() {
        backendCalled = true;
        return { appliedFiles: [], rawLog: "" };
      },
    };
    const fixturePath = join(
      repoRoot,
      "fixtures/checkout-example/fixture.yaml",
    );
    writeFileSync(
      fixturePath,
      readFileSync(fixturePath, "utf8").replace("tax: 2.5", "tax: 250"),
    );

    const error = await runPatch(
      repoRoot,
      join(repoRoot, "fixtures/checkout-example"),
      backend,
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(UsageError);
    if (error instanceof UsageError) {
      expect(error.message).toContain("clean working tree");
    }
    expect(backendCalled).toBe(false);
  });

  it("rejects non-source changes alongside a consumer repair", async () => {
    const result = await runPatch(
      repoRoot,
      join(repoRoot, "fixtures/checkout-example"),
      new NonSourceChangeBackend(),
    );
    expect(result.accepted).toBe(false);
    expect(result.worktreeDir).toBeNull();
  });

  it("rejects unrelated source changes without repairing the fixture consumer", async () => {
    const result = await runPatch(
      repoRoot,
      join(repoRoot, "fixtures/checkout-example"),
      new UnrelatedSourceBackend(),
    );
    expect(result.accepted).toBe(false);
    expect(result.worktreeDir).toBeNull();
  });

  it("rejects a backend that commits its repair and changes HEAD", async () => {
    const result = await runPatch(
      repoRoot,
      join(repoRoot, "fixtures/checkout-example"),
      new CommittingBackend(),
    );
    expect(result.accepted).toBe(false);
    expect(result.worktreeDir).toBeNull();
  });

  it("rechecks the oracle after replay executes the consumer", async () => {
    const result = await runPatch(
      repoRoot,
      join(repoRoot, "fixtures/checkout-example"),
      new MutatingDuringReplayBackend(),
    );
    expect(result.accepted).toBe(false);
    expect(result.worktreeDir).toBeNull();
    expect(
      readFileSync(
        join(repoRoot, "fixtures/checkout-example/invariant.ts"),
        "utf8",
      ),
    ).toContain("result.tax === 250");
  });

  it("throws UsageError and never calls the backend when v2 already passes", async () => {
    let backendCalled = false;
    const trackingBackend: PatchBackend = {
      async run() {
        backendCalled = true;
        return { appliedFiles: [], rawLog: "" };
      },
    };
    writeFileSync(
      join(repoRoot, "fixtures/checkout-example/invariant.ts"),
      "export default (_result: unknown) => true;",
    );
    await execFileAsync(
      "git",
      ["add", "fixtures/checkout-example/invariant.ts"],
      {
        cwd: repoRoot,
      },
    );
    await execFileAsync("git", ["commit", "-m", "passing invariant"], {
      cwd: repoRoot,
    });
    await expect(
      runPatch(
        repoRoot,
        join(repoRoot, "fixtures/checkout-example"),
        trackingBackend,
      ),
    ).rejects.toBeInstanceOf(UsageError);
    expect(backendCalled).toBe(false);
  });
});
