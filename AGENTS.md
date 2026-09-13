# AGENTS.md

Instructions for coding agents (Codex, Claude Code, etc.) working in this
repository. Humans: see `README.md` instead.

## What this repo is

MigrateProof — a CLI with two workflows over the same idea: does your code
actually survive an API change?

1. **`scan` (default, zero-config).** Runs the target project's existing
   test suite under an HTTP interceptor, mutates the API responses those
   tests receive, re-runs the tests that touched each endpoint, and
   reports every field whose change nothing caught. No fixtures, no
   authored files. The project's own assertions are the oracle.
2. **The fixture workflow** (`init`/`capture`/`replay`/`diagnose`/`patch`).
   Proves one hand-written business invariant against a deliberately
   recorded v1/v2 response pair. More setup per endpoint, answers a
   narrower and better-grounded question. Retained, not deprecated.

TypeScript, Node ESM (>=22). `msw` intercepts network calls; nothing hits a
live API during replay.

**Project status: early, unpublished, unvalidated.** The mechanism is
verified against real repositories, but no team has used it yet. Do not add
features on the assumption that a user base exists.

## Source of truth

The running code and its tests are the source of truth — `README.md` for
behaviour and usage, `src/` and `test/` for exact contracts. This repo's
internal planning history (design docs, task-by-task build logs, session
notes) is kept locally by the maintainer and isn't part of this repo; don't
expect or look for it. If you find a genuine contradiction or gap between
the README and the running code, don't invent a resolution — flag it and
ask rather than picking a side silently.

## Commands

```sh
npm test          # vitest, all tests
npm run typecheck # tsc --noEmit
npm run lint      # eslint src test
npm run format    # prettier --check src test
npm run build     # tsc
```

Run all five before considering any task done — this is what CI checks.

## Conventions

- Strict TypeScript, no `any`. Explicit param/return types on exported
  functions.
- Errors: throw `UsageError` (see `src/errors.ts`) for user-facing
  usage/config problems (exit code `2`); let unexpected errors propagate
  rather than swallowing them.
- `child_process`: always `execFile` with an argv array, never `exec` or a
  shell string built from fixture/user content — this repo has a documented
  command-injection history in its own security checklist.
- Tests live under `test/`, mirroring `src/` structure. TDD: write the
  failing test first, then the minimal implementation.
- One logical change = one commit (or a small tight group of commits),
  pushed to `main` when green. Don't batch unrelated changes into one
  commit — it makes the history useless for review, and don't let commits
  pile up unpushed — a green local run that never reaches `origin` doesn't
  help anyone, and CI on `origin/main` is the only place some bugs (e.g.
  platform-specific Docker permission differences) will ever actually show
  up.

## Running tests without cooking the machine

`npm test` (~6s) excludes the Docker sandbox suite. Use `npm run
test:sandbox` when you touch `src/sandbox/`, and `npm run test:all` before a
final push. CI runs everything regardless, so nothing is skipped as a gate.
Parallelism is capped at 4 forks in `vitest.config.ts`; leave it capped.

**Never let a spawned command re-enter this CLI.** `src/mutation/observe.ts`
runs the target project's `npm test`. If that project's suite invokes
`scan`, each level forks another full test run without bound — this
fork-bombed a real machine to 100% CPU on 2026-09-12, and killing the
processes did not help because parent levels respawned them. Two guards
exist and must not be removed or weakened: `assertNotSelfScan()` (refuses to
scan this repository) and `assertNotNestedRun()` (checks the
`MIGRATEPROOF_OBSERVING` marker). Any test that needs `scan` to actually run
must target a temp directory, never the repo root. See `docs/lessons.md`.
