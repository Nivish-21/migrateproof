// test/mutation/observe.test.ts
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  observe,
  resolveTestCommand,
  testRunArgs,
} from "../../src/mutation/observe.js";
import { UsageError } from "../../src/errors.js";
import { resolveNpmCommand } from "../../src/process/npmCommand.js";

function withPackageJson(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "mp-observe-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(contents));
  return dir;
}

describe("resolveTestCommand", () => {
  it("returns an argv array running the project's own test script", () => {
    const dir = withPackageJson({ scripts: { test: "vitest run" } });
    try {
      expect(resolveTestCommand(join(dir, "package.json"))).toEqual(
        resolveNpmCommand(["test", "--silent"]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws UsageError naming the problem when there is no test script", () => {
    const dir = withPackageJson({ scripts: { build: "tsc" } });
    try {
      expect(() => resolveTestCommand(join(dir, "package.json"))).toThrow(
        UsageError,
      );
      expect(() => resolveTestCommand(join(dir, "package.json"))).toThrow(
        /no "test" script/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws UsageError when package.json does not exist", () => {
    expect(() =>
      resolveTestCommand(join(tmpdir(), "mp-does-not-exist", "package.json")),
    ).toThrow(UsageError);
  });

  it("resolves npm through its JavaScript entry point on Windows", () => {
    const dir = withPackageJson({ scripts: { test: "vitest run" } });
    const npmCliPath = join(dir, "npm-cli.js");
    const platformDescriptor = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    );
    writeFileSync(npmCliPath, "");
    vi.stubEnv("npm_execpath", npmCliPath);
    Object.defineProperty(process, "platform", {
      ...platformDescriptor,
      value: "win32",
    });

    try {
      expect(resolveTestCommand(join(dir, "package.json"))).toEqual([
        process.execPath,
        npmCliPath,
        "test",
        "--silent",
      ]);
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor);
      }
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("observe", () => {
  it.each([
    ["mjs", false],
    ["cjs", false],
    ["mjs", true],
  ] as const)(
    "attributes a %s test in a path containing spaces and parentheses (top level: %s)",
    async (extension, topLevel) => {
      const dir = withPackageJson({ scripts: { test: "node --test" } });
      const testDirectory = join(dir, "test dir (v1) %20");
      mkdirSync(testDirectory);
      const testPath = join(testDirectory, `order (gross).test.${extension}`);
      writeFileSync(
        testPath,
        [
          extension === "mjs"
            ? 'import test from "node:test";'
            : 'const test = require("node:test");',
          topLevel ? "" : 'test("records the request", async () => {',
          '  globalThis.fetch = async () => new Response("{\\"amount\\":12}");',
          '  await fetch("https://api.example.test/order");',
          topLevel ? "" : "});",
        ].join("\n"),
      );
      try {
        const result = await observe(dir);
        expect(result.baseline.passed).toBe(true);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0]?.touchingTests).toEqual([
          realpathSync(testPath),
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.each([
    "C:\\projects\\space repo (v1)\\order.test.cjs",
    "\\\\server\\share\\space repo (v1)\\order.test.cjs",
  ])("preserves the native stack-frame path %s", async (testPath) => {
    const dir = withPackageJson({ scripts: { test: "node probe.mjs" } });
    const stack = `Error\n    at wrapped (/runtime.js:1:1)\n    at request (${testPath}:10:2)`;
    writeFileSync(
      join(dir, "probe.mjs"),
      [
        `Error.prepareStackTrace = () => ${JSON.stringify(stack)};`,
        'globalThis.fetch = async () => new Response("{}");',
        'await fetch("https://api.example.test/order");',
      ].join("\n"),
    );
    try {
      const result = await observe(dir);
      expect(result.baseline.passed).toBe(true);
      expect(result.calls[0]?.touchingTests).toEqual([testPath]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves Node options and the recursion marker with a file URL import", async () => {
    const dir = withPackageJson({ scripts: { test: "node check-env.js" } });
    mkdirSync(join(dir, "node_modules"));
    const setupModule = join(
      process.cwd(),
      "src",
      "mutation",
      "observeSetup.ts",
    );
    const expectedOptions = `--trace-warnings --import=${pathToFileURL(setupModule).href}`;
    writeFileSync(
      join(dir, "check-env.js"),
      [
        'import assert from "node:assert/strict";',
        `assert.equal(process.env.NODE_OPTIONS, ${JSON.stringify(expectedOptions)});`,
        'assert.equal(process.env.MIGRATEPROOF_OBSERVING, "1");',
        'console.log("Tests 1 passed");',
      ].join("\n"),
    );
    vi.stubEnv("NODE_OPTIONS", "--trace-warnings");

    try {
      const result = await observe(dir);
      expect(result.baseline.passed).toBe(true);
      expect(result.testsRan).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records a failed baseline test process", async () => {
    const dir = withPackageJson({
      scripts: {
        test: "node -e \"console.log('Tests 0 passed, 1 failed'); process.exit(1)\"",
      },
    });
    mkdirSync(join(dir, "node_modules"));
    try {
      const result = await observe(dir);
      expect(result.baseline).toMatchObject({ passed: false, exitCode: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records Request methods and explicit init method overrides", async () => {
    const dir = withPackageJson({ scripts: { test: "node --test" } });
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(
      join(dir, "requests.test.js"),
      [
        'import { test } from "node:test";',
        'test("request methods", async () => {',
        '  globalThis.fetch = async () => new Response("{}", { headers: { "content-type": "application/json" } });',
        '  await fetch(new Request("https://api.example.test/items", { method: "POST" }));',
        '  await fetch(new Request("https://api.example.test/items", { method: "POST" }), { method: "PUT" });',
        "});",
      ].join("\n"),
    );

    try {
      const result = await observe(dir);
      expect(result.calls.map(({ method }) => method)).toEqual(["POST", "PUT"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks repeated requests ambiguous when status or body differs", async () => {
    const dir = withPackageJson({ scripts: { test: "node --test" } });
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(
      join(dir, "requests.test.js"),
      [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'test("repeated responses", async () => {',
        "  const responses = [",
        '    new Response("{\\"id\\":1,\\"tax\\":250}", { status: 200, headers: { "content-type": "application/json" } }),',
        '    new Response("{\\"id\\":2,\\"tax\\":250}", { status: 201, headers: { "content-type": "application/json" } }),',
        "  ];",
        "  globalThis.fetch = async () => responses.shift();",
        '  const first = await fetch("https://api.example.test/items").then((response) => response.json());',
        '  const second = await fetch("https://api.example.test/items").then((response) => response.json());',
        "  assert.equal(first.id, 1);",
        "  assert.equal(second.id, 2);",
        "});",
      ].join("\n"),
    );

    try {
      const result = await observe(dir);
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]?.responseAmbiguous).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks status-only differences as ambiguous", async () => {
    const dir = withPackageJson({ scripts: { test: "node --test" } });
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(
      join(dir, "requests.test.js"),
      [
        'import { test } from "node:test";',
        'test("status-only response difference", async () => {',
        "  const responses = [",
        '    new Response("{\\"id\\":1}", { status: 200, headers: { "content-type": "application/json" } }),',
        '    new Response("{\\"id\\":1}", { status: 201, headers: { "content-type": "application/json" } }),',
        "  ];",
        "  globalThis.fetch = async () => responses.shift();",
        '  await fetch("https://api.example.test/items");',
        '  await fetch("https://api.example.test/items");',
        "});",
      ].join("\n"),
    );

    try {
      const result = await observe(dir);
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]?.responseAmbiguous).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs only the given test files, with the runner's worker cap", async () => {
    const dir = withPackageJson({ scripts: { test: "node --test" } });
    mkdirSync(join(dir, "node_modules"));
    for (const name of ["selected", "other"]) {
      writeFileSync(
        join(dir, `${name}.test.mjs`),
        [
          'import { test } from "node:test";',
          `test("${name}", async () => {`,
          '  globalThis.fetch = async () => new Response("{}", { headers: { "content-type": "application/json" } });',
          `  await fetch("https://api.example.test/${name}");`,
          "});",
        ].join("\n"),
      );
    }

    try {
      const result = await observe(dir, ["selected.test.mjs"]);
      expect(result.baseline.passed).toBe(true);
      expect(result.calls.map(({ url }) => url)).toEqual([
        "https://api.example.test/selected",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds the args after npm's separator: worker cap first, then files", () => {
    const dir = withPackageJson({ scripts: { test: "vitest run" } });
    try {
      expect(testRunArgs(join(dir, "package.json"), ["a.test.ts"])).toEqual([
        "--",
        "--maxWorkers=2",
        "--minWorkers=1",
        "a.test.ts",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends nothing for an unknown runner with no files", () => {
    const dir = withPackageJson({ scripts: { test: "mocha" } });
    try {
      expect(testRunArgs(join(dir, "package.json"), [])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records a mocked fetch that resolves a plain object instead of a Response", async () => {
    const dir = withPackageJson({ scripts: { test: "node --test" } });
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(
      join(dir, "plain.test.js"),
      [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'test("plain-object response with a one-shot json()", async () => {',
        "  let reads = 0;",
        "  globalThis.fetch = async () => ({",
        "    ok: true,",
        "    status: 200,",
        "    json: async () => (reads++ === 0 ? { stage: \"RUNNING\" } : undefined),",
        "  });",
        '  const response = await fetch("https://api.example.test/space");',
        '  assert.deepEqual(await response.json(), { stage: "RUNNING" });',
        "});",
      ].join("\n"),
    );

    try {
      const result = await observe(dir);
      expect(result.baseline.passed).toBe(true);
      expect(result.calls).toEqual([
        expect.objectContaining({
          url: "https://api.example.test/space",
          status: 200,
          body: { stage: "RUNNING" },
        }),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps identical repeated responses usable", async () => {
    const dir = withPackageJson({ scripts: { test: "node --test" } });
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(
      join(dir, "requests.test.js"),
      [
        'import { test } from "node:test";',
        'test("identical repeated responses", async () => {',
        '  globalThis.fetch = async () => new Response("{\\"id\\":1,\\"tax\\":250}", { headers: { "content-type": "application/json" } });',
        '  await fetch("https://api.example.test/items");',
        '  await fetch("https://api.example.test/items");',
        "});",
      ].join("\n"),
    );

    try {
      const result = await observe(dir);
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]?.responseAmbiguous).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
