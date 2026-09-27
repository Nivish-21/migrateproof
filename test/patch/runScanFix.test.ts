import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mutationRunner from "../../src/mutation/runMutations.js";
import { runScanFix } from "../../src/patch/runScanFix.js";
import type { PatchBackend, PatchBackendInput } from "../../src/patch/types.js";

const execFileAsync = promisify(execFile);
const pathStyle = vi.hoisted(() => ({ windows: false }));
vi.mock("node:path", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:path")>();
  return {
    ...original,
    get sep() {
      return pathStyle.windows ? "\\" : original.sep;
    },
    relative: (from: string, to: string): string => {
      const result = original.relative(from, to);
      return pathStyle.windows ? result.replaceAll("/", "\\") : result;
    },
  };
});
const originalSource = `export async function total() {
  const body = await (await fetch("http://localhost/order")).json();
  return body.subtotal + body.tax;
}
`;
const fixedSource = originalSource.replace(
  "body.subtotal + body.tax",
  "body.total",
);

describe("runScanFix", { timeout: 30_000 }, () => {
  let repoRoot: string;
  const worktrees: string[] = [];

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "mp-scan-fix-"));
    writeFileSync(join(repoRoot, ".gitignore"), "node_modules/\n");
    writeFileSync(
      join(repoRoot, "package.json"),
      JSON.stringify({
        name: "scan-fix-consumer",
        type: "module",
        scripts: { test: "node --test" },
      }),
    );
    writeFileSync(join(repoRoot, "consumer.mjs"), originalSource);
    writeFileSync(
      join(repoRoot, "consumer.test.mjs"),
      `import assert from "node:assert/strict";
import test from "node:test";
import { total } from "./consumer.mjs";
globalThis.fetch = async () => new Response(JSON.stringify({ subtotal: 1000, tax: 200, total: 1200 }));
test("preserves the order total", async () => { assert.equal(await total(), 1200); });
`,
    );
    writeFileSync(
      join(repoRoot, "changes.json"),
      JSON.stringify({
        api: "localhost",
        changes: [
          {
            endpoint: "GET /order",
            field: "tax",
            kind: "unit-change",
            factor: 100,
          },
        ],
      }),
    );
    await execFileAsync("git", ["init"], { cwd: repoRoot });
    await execFileAsync("git", ["add", "."], { cwd: repoRoot });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "consumer",
      ],
      { cwd: repoRoot },
    );
  });

  afterEach(async () => {
    pathStyle.windows = false;
    vi.restoreAllMocks();
    for (const worktree of worktrees.splice(0)) {
      await execFileAsync("git", ["worktree", "remove", "--force", worktree], {
        cwd: repoRoot,
      });
    }
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function backend(
    edit: (input: PatchBackendInput) => void | Promise<void>,
  ): PatchBackend {
    return {
      async run(input) {
        worktrees.push(input.worktreeDir);
        await edit(input);
        return { appliedFiles: [], rawLog: "not public output" };
      },
    };
  }

  it("verifies a source repair against the same change and unchanged tests", async () => {
    const result = await runScanFix(
      repoRoot,
      "changes.json",
      backend((input) => {
        expect(input.instructions).toContain("tax");
        expect(input.instructions).toContain("consumer.test.mjs");
        writeFileSync(join(input.worktreeDir, "consumer.mjs"), fixedSource);
      }),
    );
    expect(result.status).toBe("compatible-candidate");
    expect(result.before.status).toBe("caught");
    expect(result.after?.status).toBe("missed");
    expect(result.changedFiles).toEqual(["consumer.mjs"]);
    expect(readFileSync(join(repoRoot, "consumer.mjs"), "utf8")).toBe(
      originalSource,
    );
    expect(
      (await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot }))
        .stdout,
    ).toBe("");
  });

  it("accepts an alternate spelling of the Git repository root", async () => {
    const alternateRoot = join(
      dirname(repoRoot),
      basename(repoRoot).toUpperCase(),
    );
    const needsAlias = !existsSync(alternateRoot);
    if (needsAlias) symlinkSync(repoRoot, alternateRoot, "junction");
    try {
      const result = await runScanFix(
        alternateRoot,
        "changes.json",
        backend((input) => {
          writeFileSync(join(input.worktreeDir, "consumer.mjs"), fixedSource);
        }),
      );
      expect(result.status).toBe("compatible-candidate");
      expect(readFileSync(join(repoRoot, "consumer.mjs"), "utf8")).toBe(
        originalSource,
      );
    } finally {
      if (needsAlias) rmSync(alternateRoot);
    }
  });

  it("rejects a real subdirectory before scanning or invoking the backend", async () => {
    const nested = join(repoRoot, "nested");
    mkdirSync(nested);
    const scan = vi.spyOn(mutationRunner, "runMutations");
    await expect(
      runScanFix(
        nested,
        "../changes.json",
        backend(() => {
          throw new Error("must not run");
        }),
      ),
    ).rejects.toThrow("run scan --fix from the Git repository root");
    expect(scan).not.toHaveBeenCalled();
    expect(worktrees).toEqual([]);
  });

  it("rejects a directory outside an explicitly configured worktree", async () => {
    const outside = mkdtempSync(join(tmpdir(), "mp-outside-root-"));
    const scan = vi
      .spyOn(mutationRunner, "runMutations")
      .mockRejectedValue(new Error("must not scan outside the worktree"));
    vi.stubEnv("GIT_DIR", join(repoRoot, ".git"));
    vi.stubEnv("GIT_WORK_TREE", repoRoot);
    try {
      await expect(
        runScanFix(
          outside,
          "changes.json",
          backend(() => {
            throw new Error("must not run");
          }),
        ),
      ).rejects.toThrow("run scan --fix from the Git repository root");
      expect(scan).not.toHaveBeenCalled();
      expect(worktrees).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each([
    "no-op",
    "assertion",
    "changes",
    "script",
    "untracked",
    "commit",
    "failure",
  ])("rejects a %s backend without a false success", async (action) => {
    const result = await runScanFix(
      repoRoot,
      "changes.json",
      backend(async (input) => {
        if (action === "assertion")
          writeFileSync(
            join(input.worktreeDir, "consumer.test.mjs"),
            "export {};\n",
          );
        if (action === "changes")
          writeFileSync(join(input.worktreeDir, "changes.json"), "{}\n");
        if (action === "script")
          writeFileSync(join(input.worktreeDir, "package.json"), "{}\n");
        if (action === "untracked") {
          writeFileSync(join(input.worktreeDir, "consumer.mjs"), fixedSource);
          mkdirSync(join(input.worktreeDir, "unexpected"));
          writeFileSync(
            join(input.worktreeDir, "unexpected", "file"),
            "untracked",
          );
        }
        if (action === "commit") {
          writeFileSync(join(input.worktreeDir, "consumer.mjs"), fixedSource);
          await execFileAsync("git", ["add", "."], { cwd: input.worktreeDir });
          await execFileAsync(
            "git",
            [
              "-c",
              "user.name=Test",
              "-c",
              "user.email=test@example.invalid",
              "commit",
              "-m",
              "disallowed commit",
            ],
            { cwd: input.worktreeDir },
          );
        }
        if (action === "failure") throw new Error("private backend output");
      }),
    );
    expect(result.status).toBe("rejected");
    expect(result.worktreeDir).toBe(worktrees[0]);
    expect(JSON.stringify(result)).not.toContain("private backend output");
    expect(readFileSync(join(repoRoot, "consumer.mjs"), "utf8")).toBe(
      originalSource,
    );
  });

  it("rejects assertion changes in a camelCase test helper", async () => {
    writeFileSync(
      join(repoRoot, "testUtils.mjs"),
      'export { default } from "node:assert/strict";\n',
    );
    const testPath = join(repoRoot, "consumer.test.mjs");
    writeFileSync(
      testPath,
      readFileSync(testPath, "utf8").replace(
        '"node:assert/strict"',
        '"./testUtils.mjs"',
      ),
    );
    await execFileAsync("git", ["add", "."], { cwd: repoRoot });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "test helper",
      ],
      { cwd: repoRoot },
    );
    const result = await runScanFix(
      repoRoot,
      "changes.json",
      backend((input) => {
        writeFileSync(
          join(input.worktreeDir, "testUtils.mjs"),
          "export default { equal() {} };\n",
        );
      }),
    );
    expect(result.status).toBe("rejected");
  });

  it("normalises nested Git paths returned with Windows separators", async () => {
    mkdirSync(join(repoRoot, "config"));
    mkdirSync(join(repoRoot, "test", "contracts"), { recursive: true });
    renameSync(
      join(repoRoot, "changes.json"),
      join(repoRoot, "config", "changes.json"),
    );
    const testPath = join(repoRoot, "test", "contracts", "order.test.mjs");
    renameSync(join(repoRoot, "consumer.test.mjs"), testPath);
    writeFileSync(
      testPath,
      readFileSync(testPath, "utf8").replace(
        "./consumer.mjs",
        "../../consumer.mjs",
      ),
    );
    await execFileAsync("git", ["add", "."], { cwd: repoRoot });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "nested paths",
      ],
      { cwd: repoRoot },
    );
    pathStyle.windows = true;
    const result = await runScanFix(
      repoRoot,
      "config/changes.json",
      backend((input) => {
        writeFileSync(join(input.worktreeDir, "consumer.mjs"), fixedSource);
      }),
    );
    expect(result.status).toBe("compatible-candidate");
  });

  it("refuses outside changes files with Windows relative separators", async () => {
    const outside = mkdtempSync(join(tmpdir(), "mp-outside-changes-"));
    writeFileSync(join(outside, "changes.json"), "{}");
    pathStyle.windows = true;
    try {
      await expect(
        runScanFix(
          repoRoot,
          join(outside, "changes.json"),
          backend(() => {
            throw new Error("must not run");
          }),
        ),
      ).rejects.toThrow("inside the repository");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a dirty baseline before invoking the backend", async () => {
    writeFileSync(join(repoRoot, "consumer.mjs"), fixedSource);
    await expect(
      runScanFix(
        repoRoot,
        "changes.json",
        backend(() => {
          throw new Error("must not run");
        }),
      ),
    ).rejects.toThrow("clean working tree");
    expect(worktrees).toEqual([]);
  });

  it("rejects a repair that changes ignored dependencies to satisfy the tests", async () => {
    const result = await runScanFix(
      repoRoot,
      "changes.json",
      backend((input) => {
        writeFileSync(
          join(input.worktreeDir, "node_modules", "forged.mjs"),
          "export const value = 1200;\n",
        );
        writeFileSync(
          join(input.worktreeDir, "consumer.mjs"),
          `import { value } from "./node_modules/forged.mjs";
export async function total() {
  await fetch("http://localhost/order");
  return value;
}
`,
        );
      }),
    );
    expect(result.status).toBe("rejected");
  });

  it.each(["generic", "missing attribution"])(
    "rejects %s evidence without an agent call",
    async (problem) => {
      vi.spyOn(mutationRunner, "runMutations").mockResolvedValue({
        mode: problem === "generic" ? "generic" : "changes",
        verdict: "protected",
        outcomes: [
          {
            endpoint: "GET http://localhost/order",
            change: {
              endpoint: "GET /order",
              field: "tax",
              kind: "unit-change",
              factor: 100,
            },
            status: "caught",
            testFiles: [],
            testsRun: 1,
            testsFailed: 1,
          },
        ],
      });
      await expect(
        runScanFix(
          repoRoot,
          "changes.json",
          backend(() => {
            throw new Error("must not run");
          }),
        ),
      ).rejects.toThrow(
        problem === "generic" ? "cannot prove" : "attributed test files",
      );
      expect(worktrees).toEqual([]);
    },
  );

  it("rejects an ignored empty-directory condition used to fake a repair", async () => {
    const result = await runScanFix(
      repoRoot,
      "changes.json",
      backend((input) => {
        mkdirSync(join(input.worktreeDir, "node_modules", "compat-flag"));
        writeFileSync(
          join(input.worktreeDir, "consumer.mjs"),
          `import { existsSync } from "node:fs";
export async function total() {
  const body = await (await fetch("http://localhost/order")).json();
  return existsSync("node_modules/compat-flag") ? body.total : body.subtotal + body.tax;
}
`,
        );
      }),
    );
    expect(result.status).toBe("rejected");
  });

  it("does not launch code repair for a Missed-only report", async () => {
    writeFileSync(join(repoRoot, "consumer.mjs"), fixedSource);
    await execFileAsync("git", ["add", "."], { cwd: repoRoot });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "already compatible",
      ],
      { cwd: repoRoot },
    );
    await expect(
      runScanFix(
        repoRoot,
        "changes.json",
        backend(() => {
          throw new Error("must not run");
        }),
      ),
    ).rejects.toThrow("assertions");
    expect(worktrees).toEqual([]);
  });

  it.each(["baseline", "unchanged mutation", "dependencies"])(
    "refuses %s problems before invoking the backend",
    async (problem) => {
      if (problem === "baseline")
        writeFileSync(
          join(repoRoot, "consumer.mjs"),
          "export async function total() { throw new Error('baseline failure'); }\n",
        );
      if (problem === "unchanged mutation")
        writeFileSync(
          join(repoRoot, "changes.json"),
          JSON.stringify({
            api: "localhost",
            changes: [
              {
                endpoint: "GET /order",
                field: "tax",
                kind: "unit-change",
                factor: 1,
              },
            ],
          }),
        );
      if (problem === "dependencies") {
        const manifest = JSON.parse(
          readFileSync(join(repoRoot, "package.json"), "utf8"),
        ) as Record<string, unknown>;
        manifest.dependencies = { "unused-dependency": "1.0.0" };
        writeFileSync(join(repoRoot, "package.json"), JSON.stringify(manifest));
      }
      await execFileAsync("git", ["add", "."], { cwd: repoRoot });
      await execFileAsync(
        "git",
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "-m",
          "preflight problem",
        ],
        { cwd: repoRoot },
      );
      await expect(
        runScanFix(
          repoRoot,
          "changes.json",
          backend(() => {
            throw new Error("must not run");
          }),
        ),
      ).rejects.toThrow(
        problem === "dependencies" ? "package-lock.json" : "cannot prove",
      );
      expect(worktrees).toEqual([]);
    },
  );
});
