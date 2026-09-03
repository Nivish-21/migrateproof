# AGENTS.md

Instructions for coding agents (Codex, Claude Code, etc.) working in this
repository. Humans: see `README.md` instead.

## What this repo is

MigrateProof — a CLI that proves whether a consumer's real integration code
survives an API behaviour change, by replaying recorded fixtures and
checking a business invariant. TypeScript, Node ESM, zero-dependency at
replay time (no live network calls — `msw` intercepts everything).

## Source of truth, in priority order

1. `docs/superpowers/specs/2026-09-02-migrateproof-build-design.md` — the
   build spec. Exact schemas, CLI contracts, security requirements. If this
   document and the running code disagree, the code is wrong, not the spec
   — unless the spec itself is internally contradictory, in which case stop
   and ask rather than picking a side silently (this has happened before:
   see the "Worktree lifecycle" note dated 2026-09-03 in that spec).
2. `docs/superpowers/plans/2026-09-02-migrateproof-build.md` — the 21-task
   TDD implementation plan. Work through it task by task, in order.
3. `docs/status.md`, `docs/changelog.md`, `docs/plan.md`, `docs/lessons.md`
   — running project logs, append-only. Read `docs/status.md` first to see
   what's already built before starting anything.

## Hard stop

**Task 14 in the implementation plan is a gate.** Do not start Task 15
onward (V1: trace-capture, AST impact analysis, semantic-equivalence
engine, sandboxed patch execution) without both of that task's checklist
items explicitly confirmed by the user. This is not a suggestion — it
reflects a deliberate product decision to validate the MVP with real users
before building further.

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
- One task from the plan = one commit (or a small tight group of commits),
  pushed to `main` when green. Don't batch multiple plan tasks into one
  commit — it makes the audit trail useless.
- When you find a genuine contradiction or gap in the spec (not just an
  implementation question), don't invent a resolution — log it in
  `docs/lessons.md` and stop for a product decision, same as the worktree
  lifecycle bug on 2026-09-03. Silently picking a behaviour is worse than
  asking.
