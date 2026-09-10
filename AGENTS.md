# AGENTS.md

Instructions for coding agents (Codex, Claude Code, etc.) working in this
repository. Humans: see `README.md` instead.

## What this repo is

MigrateProof — a CLI that proves whether a consumer's real integration code
survives an API behaviour change, by replaying recorded fixtures and
checking a business invariant. TypeScript, Node ESM, zero-dependency at
replay time (no live network calls — `msw` intercepts everything).

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
