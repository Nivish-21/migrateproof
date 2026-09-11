# MigrateProof

[![CI](https://github.com/Nivish-21/migrateproof/actions/workflows/ci.yml/badge.svg)](https://github.com/Nivish-21/migrateproof/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

MigrateProof proves whether a consumer's real code path and business
invariant survive a recorded API behaviour change. It replays deterministic
fixtures, rather than relying on a live API during CI.

## Quick Start

```sh
git clone https://github.com/Nivish-21/migrateproof.git
cd migrateproof
npm install
npx tsx src/cli/index.ts replay fixtures/checkout-example --version v1
```

You should see `✓ checkout-total-invariant (v1) — invariant held`. That's
the whole idea: MigrateProof replayed a stored API response through real
consumer code and proved the business invariant still holds. `--version
v2` on the same fixture intentionally fails — see [Replay](#replay) below
for why.

## Install

_Note: MigrateProof is currently run from local source (`npx tsx src/cli/index.ts`). Global `npm install -g migrateproof` and `npx migrateproof` will be available once published to npm._

To run the CLI from source:

```sh
npx tsx src/cli/index.ts replay fixtures/checkout-example --version v1
```

## Capture

Record a JSON response in a fixture version slot:

```sh
npx tsx src/cli/index.ts capture fixtures/checkout-example --as v1 --from-file ./v1-response.json
```

`v1-response.json` can be the response body itself, or an object shaped as
`{ "status": 200, "body": { ... } }`. Fixtures are intended to be committed
to git and run in CI. Never capture live endpoints containing customer or
production data.

## Replay

Replay the consumer against a stored response and evaluate its invariant:

```sh
npx tsx src/cli/index.ts replay fixtures/checkout-example --version v1
npx tsx src/cli/index.ts replay fixtures/checkout-example --version v2 --json
```

`v1` passes for the checkout example. `v2` intentionally fails because the
recorded tax value changes from `250` to `2.50` while the total invariant still
expects the original representation.

MigrateProof proves the invariant holds against the _result_ your
consumer code actually returns. If your consumer's own try/catch
swallows a real error and returns a default value that happens to satisfy
the invariant, replay reports a pass — the invariant was checked against
what your code produced, not against whether it produced it correctly.
This is a property of testing real code, not a bug.

## Patch

After a failed v2 replay, ask a configured AI coding agent backend to propose a fix in
an isolated git worktree:

```sh
npx tsx src/cli/index.ts patch fixtures/checkout-example --patch-backend codex
```

### Supported backends (`--patch-backend`)

| Backend | CLI Command | Notes |
|---|---|---|
| `codex` *(default)* | `codex` | Uses `codex exec` in non-interactive mode |
| `claude` | `claude` | Claude Code CLI with bypassPermissions in isolated worktree |
| `gemini` | `gemini` | Gemini CLI with `--yolo` |
| `copilot` | `copilot` | GitHub Copilot CLI with `--allow-all-tools` |
| `opencode` | `opencode` | OpenCode with positional prompt and `--dir`/`--auto` |
| `cursor-agent` | `cursor-agent` | Built from documented CLI syntax; less battle-tested than the other five |

MigrateProof runs all backends under a bounded timeout wrapper (default 10 minutes, configurable via `MIGRATEPROOF_BACKEND_TIMEOUT_MS`), then reruns the v2 replay in that worktree and reports whether the proposal is accepted. It never merges a patch automatically.

- **Rejected** (rerun still fails): the worktree is removed automatically.
- **Accepted** (rerun passes): the worktree is left on disk and the CLI
  prints its path plus the exact next steps:

  ```sh
  cd <printed worktree path>
  git diff
  # merge the change into your branch, then:
  git worktree remove --force <printed worktree path>
  ```

  Accepted worktrees are not garbage-collected — if you run `patch`
  repeatedly without cleaning up, run `git worktree list` /
  `git worktree prune` to clear stale ones.

## Fixture format

```yaml
schemaVersion: 1
name: checkout-total-invariant
description: >
  Consumer checkout flow expects order total to equal sum(lineItems) + tax.
request:
  method: GET
  url: https://api.example.com/v1/orders/123
responses:
  v1:
    status: 200
    body:
      { orderId: "123", lineItems: [{ price: 2500 }], tax: 250, total: 2750 }
  v2:
    status: 200
    body:
      { orderId: "123", lineItems: [{ price: 2500 }], tax: 2.50, total: 2750 }
invariant: ./invariant.ts
consumer: ./consumer.ts
```

MVP matching is literal: the consumer must make the fixture's exact method and
URL. Dynamic URLs and real-traffic capture are outside this release's scope.

The fixture's `request` block captures method and URL only — headers,
auth tokens, and request bodies are not part of the MVP fixture model.
An API that requires auth headers to respond correctly cannot be
represented by a v1/v2 fixture pair yet.

### V1: auto-extracted invariants

`invariant-extraction` can generate `invariant.ts` automatically from a consumer test file's existing `expect(...)` assertions, instead of writing the predicate by hand. In scope: `expect(<propertyAccessChain>).toBe(<literal>)` and `.toEqual(<literal>)`, where `<propertyAccessChain>` is rooted at the captured result variable (e.g. `result.total`, `result.items[0].price`) and the matcher's argument is itself a literal (number, string, boolean, or `null`). Out of scope, and logged as skipped rather than silently dropped: custom matchers, `toHaveProperty`, `toThrow`, async assertion helpers, multi-statement setup, and any matcher argument that isn't a literal (e.g. a variable reference). A human writes `invariant.ts` by hand for anything skipped, exactly as every fixture already requires without auto-extraction.

### V1: Python impact analysis prerequisite

Python-based impact analysis (`py/impact_analysis.py`) requires Python 3.x on `PATH`. If it isn't found, the command fails with: `python3 not found on PATH — required for Python impact analysis`. This is only required when using Python-specific impact analysis — TypeScript impact analysis (`src/ast/ts/`) has no Python dependency.

### V1: Docker sandbox residual limitation

The sandboxed `patch` execution path installs consumer dependencies with `npm ci --ignore-scripts`, which blocks `postinstall`/`preinstall`/`install`/`prepare` scripts for npm-registry-sourced packages. A git-sourced dependency's own `prepare` script is a known, documented upstream limitation of `--ignore-scripts` this project does not attempt to work around — a consumer project depending on such a package will see that dependency fail to build correctly inside the sandbox. Native Windows is not supported for the Docker sandbox; use WSL2.

## GitHub Action

Add this workflow to a repository using MigrateProof:

```yaml
name: MigrateProof
on:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx tsx src/cli/index.ts replay --all --version v2 --json > migrateproof-result.json
      - if: always()
        run: node .github/scripts/annotate.js migrateproof-result.json
```

The Action replays stored v2 fixtures. It does not monitor a live API or
automatically discover new production breaks.

This workflow uses `pull_request`, not `pull_request_target` — fork PRs never get access to repository secrets, even though fixture code executes in-process during replay.
