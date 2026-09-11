import { defineConfig } from "vitest/config";

// The Docker sandbox suite only. Split out of the default `npm test` because
// it starts two real containers per test (18 per run) and saturates a core.
// Run it with `npm run test:sandbox` before pushing changes to src/sandbox/,
// and note the suite self-skips when `docker info` fails, so it is safe to run
// with Docker Desktop closed — it will report skipped, not passed.
export default defineConfig({
  test: {
    include: ["test/sandbox/**/*.test.ts"],
    pool: "forks",
    // One at a time: concurrent container churn is what makes this suite hurt.
    poolOptions: {
      forks: { maxForks: 1 },
    },
  },
});
