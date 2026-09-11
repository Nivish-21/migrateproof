import { defineConfig } from "vitest/config";

// The Docker sandbox suite (test/sandbox/runSandboxed.test.ts) starts two real
// containers per test, 18 per full run. It is slow, it pins a CPU core, and it
// is irrelevant to most changes — only `patch` uses the sandbox at all.
//
// So it is excluded from the default `npm test` and runs under `npm run
// test:sandbox` instead. Run that before pushing anything that touches
// src/sandbox/, and note that CI runs the full suite regardless (see
// .github/workflows/ci.yml), so an excluded test is still a gate, just not one
// paid for on every local iteration.
//
// maxForks is capped because the default is one worker per CPU core, which on
// a laptop means every core saturated for the length of a run.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "test/sandbox/**"],
    pool: "forks",
    poolOptions: {
      forks: { maxForks: 4 },
    },
  },
});
