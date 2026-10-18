import { describe, expect, it } from "vitest";
import { workerCapArgs } from "../../src/process/workerCap.js";

describe("workerCapArgs", () => {
  it.each([
    ["vitest", ["--maxWorkers=2", "--minWorkers=1"]],
    ["vitest run", ["--maxWorkers=2", "--minWorkers=1"]],
    [
      "vitest --project=server --project=ssr",
      ["--maxWorkers=2", "--minWorkers=1"],
    ],
    ["npx vitest run", ["--maxWorkers=2", "--minWorkers=1"]],
    ["jest", ["--maxWorkers=2"]],
    ["jest --coverage", ["--maxWorkers=2"]],
    ["node --test", ["--test-concurrency=2"]],
    ["node --test --experimental-strip-types", ["--test-concurrency=2"]],
    ["tsc -b && vitest run", ["--maxWorkers=2", "--minWorkers=1"]],
  ])("caps workers for %j", (script, expected) => {
    expect(workerCapArgs(script)).toEqual(expected);
  });

  it.each([
    "mocha",
    "node scripts/test.js",
    "npm run unit",
    "vitest run && node scripts/after.js",
    "cross-env NODE_ENV=test jest; echo done",
  ])("adds nothing for an unrecognised final command %j", (script) => {
    expect(workerCapArgs(script)).toEqual([]);
  });
});
