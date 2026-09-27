# MigrateProof

[![CI](https://github.com/Nivish-21/migrateproof/actions/workflows/ci.yml/badge.svg)](https://github.com/Nivish-21/migrateproof/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

Replays existing fetch-based consumer tests against documented API changes and
reports the changes they miss.

When your tests catch a documented break, `scan --fix` can ask an installed
AI coding agent for a source repair, check it against the unchanged tests,
and leave the candidate in a separate Git worktree for your review.

> **Status: early, not published to npm.** Run it from a clone (see below).
> The mechanism works and is verified against real repositories, but no
> team has used this in anger yet. Treat it as a working prototype, not a
> dependency.

## Verification snapshot — 27 September 2026

Code revision [`808fa0c`](https://github.com/Nivish-21/migrateproof/commit/808fa0c9c771b17e694c4ac99d5da4b41f70fae9)
passed 338 standard tests and 18 real Docker-suite tests locally, with no
skips. Formatting, lint, typechecking, build and installed-package smoke
checks also passed. [GitHub CI for that revision](https://github.com/Nivish-21/migrateproof/actions/runs/36309926757)
passed the full Ubuntu gate and native Windows smoke/package checks. The CI
badge tracks the latest workflow result rather than this dated snapshot.

Three synthetic live Codex repair cases passed: a removed field, a unit
change and a nullable nested object. Those calls preceded the latest
portability fixes; subsequent checks used offline or stub backends. This is
not a general repair success rate. The other five adapters have not been
live-tested, and real-user adoption remains unvalidated.

## Quick Start: migration-aware scan

### Prerequisites

- Node 22+.
- An `npm test` command with a passing baseline.
- JSON responses reached through `globalThis.fetch`.

MigrateProof supports only JSON responses reached through `globalThis.fetch`.
Axios, Node `http`/`https`, and mocked application wrappers are unsupported.
If no fetch request is observed, the result is **Cannot prove**. It is not
evidence of a particular mocking choice.

### Clone, build, and run a pilot

Create the `changes.json` file shown below, then run:

```sh
git clone https://github.com/Nivish-21/migrateproof.git
cd migrateproof && npm ci && npm run build
cd "/path/to/your/project"
node "/absolute/path/to/migrateproof/dist/cli/index.js" --changes changes.json
```

Replace `/absolute/path/to/migrateproof` with the clone you built. Do not run
`npx migrateproof`: the package has not been published.

### Platforms

The full local validation above ran on macOS; CI runs the full gate on
Ubuntu. Native Windows CI passes smoke and installed-package checks on
Node 22, including a stubbed source repair from an alternate-case Git root.
It does not verify live AI backends or Docker on Windows.

On Windows, npm must provide `npm-cli.js`, either alongside Node or through
npm's `npm_execpath`; unsupported installations fail with a usage error.
Backend `.cmd`/`.bat` launchers are not run through a shell: use a supported
executable or run inside WSL with Linux-installed tools. The Docker sandbox
does not support native Windows; use WSL2.

### `changes.json`

Use the migration guide, changelog, or API specification to describe each
documented response change:

This example is synthetic. It describes no real provider or upstream change.

```json
{
  "api": "api.example.com",
  "changes": [
    {
      "endpoint": "GET /v1/items/{id}",
      "field": "amount",
      "kind": "unit-change",
      "factor": 100,
      "note": "synthetic unit change for demonstration"
    }
  ]
}
```

For a real migration, set `source` to the authoritative migration guide.

### Disposable weak-versus-strong example (POSIX shell)

This uses Node's built-in test runner and a stubbed `globalThis.fetch`; it
does not contact an API or need credentials. Set `CLI` to the built CLI from
the clone above, then paste the block. It creates and removes a temporary
consumer project. The weak assertion should report `gaps` (exit 1); the
strong assertion should report `protected` (exit 0).

```sh
(
CLI="/absolute/path/to/migrateproof/dist/cli/index.js"
demo="$(mktemp -d)"
trap 'rm -rf "$demo"' EXIT
mkdir -p "$demo/test"
cd "$demo"

cat > package.json <<'EOF'
{"name":"migrateproof-demo","private":true,"type":"module","scripts":{"test":"node --test"}}
EOF
cat > changes.json <<'EOF'
{"api":"api.example.com","changes":[{"endpoint":"GET /v1/item","field":"amount","kind":"unit-change","factor":100}]}
EOF
cat > test/consumer.test.mjs <<'EOF'
import assert from "node:assert/strict";
import test from "node:test";

globalThis.fetch = async () =>
  new Response(JSON.stringify({ amount: 10 }), {
    headers: { "content-type": "application/json" },
  });

test("checks the item response", async () => {
  const response = await globalThis.fetch("https://api.example.com/v1/item");
  const body = await response.json();
  assert.ok(body);
  if (process.env.STRONG === "1") assert.equal(body.amount, 10);
});
EOF

if STRONG=0 node "$CLI" --changes changes.json --json; then weak_status=0; else weak_status=$?; fi
test "$weak_status" -eq 1
if STRONG=1 node "$CLI" --changes changes.json --json; then strong_status=0; else strong_status=$?; fi
test "$strong_status" -eq 0
)
```

The first JSON report has verdict `gaps` and outcome `missed`; the second has
verdict `protected` and outcome `caught`. With `--json`, valid reports go to
stdout. Usage or configuration errors can still go to stderr and have no
defined JSON error schema.

### Outcomes and exit codes

| Verdict      | Exit | Meaning                                                                                      |
| ------------ | ---- | -------------------------------------------------------------------------------------------- |
| `protected`  | `0`  | Every result is **Caught**.                                                                  |
| `gaps`       | `1`  | Any result is **Missed**, even if another result is **Cannot prove**.                        |
| `incomplete` | `2`  | No result is **Missed** and at least one result is **Cannot prove**. Follow its next action. |

When supplied, `source` is printed in the report so a reviewer can check the
documented changes behind the result.

### Change kinds

| `kind`           | What MigrateProof does to the response   | Additional fields required                          |
| ---------------- | ---------------------------------------- | --------------------------------------------------- |
| `removed`        | Deletes the field (`delete body[field]`) | none                                                |
| `now-nullable`   | Sets the field value to `null`           | none                                                |
| `unit-change`    | Multiplies the numeric value by `factor` | `factor` (number)                                   |
| `type-changed`   | Coerces value to the requested type      | `to-type` (`"string"` \| `"number"` \| `"boolean"`) |
| `new-enum-value` | Sets field to an unexpected enum string  | `value` (string or null)                            |

### Endpoint matching

- `endpoint` matches the HTTP method (case-insensitive) and path.
- Path parameters wrapped in braces like `{id}` match any single path segment.
- Hostnames match against `api`. (For local test servers, loopback ports are normalized automatically).
- A no-op or ambiguous response change, an unconfirmed mutation, or a rerun
  that cannot be established is **Cannot prove**, not a missed or caught change.

### Limits of migration proof

The tool tests what the changes file says, so a wrong changes file produces a
confident wrong answer. If you omit a breaking change or describe it
incorrectly, MigrateProof cannot prove coverage for that undocumented change.
The target must have a passing `npm test` script whose runner reports test
counts MigrateProof can parse (Node `--test`, Vitest, or Jest). Only JSON
responses reached through `globalThis.fetch` are observed. Other clients,
non-JSON responses, missing test attribution, and unparseable test-runner
output can leave a result **Cannot prove**.

`scan` runs the target's `npm test` on the host without Docker isolation.
Tests can execute arbitrary code and inherit the environment. The `patch`
command also runs the configured coding agent with that agent's permissions
inside a Git worktree; a worktree is not a security sandbox. Use these
commands only with repositories you trust. Stub API calls where possible;
otherwise use dedicated, least-privilege test credentials and never
production credentials. Keep real secrets and customer data out of changes
files, test output, fixtures, and reports.

### Propose a source fix for a caught change

Use `--fix` when a documented API change is **Caught**: the unchanged test
fails when MigrateProof supplies that response. It proposes a consumer-source
repair for only the first **Caught** change. A **Missed**-only scan needs
grounded assertion guidance; it does not launch a code repair.

The repository root, `changes.json`, and attributed tests must be committed,
and the repository must have a clean working tree. Run from the Git root:

```sh
node "/absolute/path/to/migrateproof/dist/cli/index.js" scan --changes changes.json --fix --patch-backend codex --json
```

The backend defaults to `codex`; the other choices are `claude`, `gemini`,
`copilot`, `opencode`, and `cursor-agent`, matching the fixture `patch`
command. This runs the installed agent CLI on the host using its local
authentication. Install and authenticate that CLI separately before running
`--fix`; MigrateProof does not install it or provide model access. Codex runs
with `--sandbox workspace-write`; other adapters may grant broad host-tool
permissions (see the backend table below). Use only a trusted repository.
MigrateProof does not request or print credentials, and the JSON result does
not include raw agent logs. Your selected agent may send source and test
context to its provider; check that provider's data-handling policy first.

If the project has dependencies, commit `package-lock.json`. MigrateProof
prepares the separate worktree with `npm ci --ignore-scripts`; it does not
reuse the original `node_modules`. The agent may change only existing,
tracked JavaScript or TypeScript consumer source. New files, tests, fixtures,
configuration, dependency manifests, and lockfile edits are rejected.

Untracked files and directory permissions are checked too, including ignored
dependencies and empty directories. Agent-generated caches or other side
effects can conservatively reject a candidate; inspect the retained worktree.

Attributed test files are protected exactly; other test/support paths use
filename heuristics, not whole-program analysis. Review helper imports and
the source diff for weakened assertions or hard-coded answers. This is not
a sandbox for untrusted agents or proof that an oracle cannot be bypassed.

The candidate must pass the unchanged tests against both the original
response and the documented changed response. `compatible-candidate` means
that this one repair passed that check; it is not a **protected** verdict and
does not mean every API change or remaining test gap is fixed. Review
`remainingOutcomes` and the worktree diff. The selected change can still be
**Missed** by an ordinary scan because its assertion remains unchanged.

With `--json`, the report has `kind: "scan-fix"`, `status`, `before`,
`after`, `worktreeDir`, `changedFiles`, `remainingOutcomes`, and `reason`.
`before` is the selected change before the agent; `after` verifies it
afterwards. A compatible candidate has `before.status: "caught"` and
`after.status: "missed"`: the unchanged tests now pass the changed response.
`changedFiles` lists the source diff, and `remainingOutcomes` holds other
results from the initial scan.
Status is `compatible-candidate` or `rejected`; exit codes are `0` for a
candidate, `1` for a rejected proposal, and `2` for usage, preflight, or
incomplete errors. Valid JSON is written to stdout; errors may be written to
stderr without a JSON error schema. After the agent runs, both accepted and
rejected worktrees are retained for human review. Nothing is merged
automatically. Fixture `patch` has a separate cleanup policy and removes
rejected worktrees.

## Exploratory mode

Run the built CLI without `--changes` to generate plausible response changes
from requests your tests happened to make:

```sh
node "/absolute/path/to/migrateproof/dist/cli/index.js"
```

This is a guess about blind spots, not migration proof. Use a documented
`changes.json` file when you need a result tied to an actual API change.

## Advanced: proving a specific invariant with fixtures

The zero-config scan above infers gaps from what your tests already
assert. If you instead want to prove one specific, hand-written business
rule against a deliberately recorded pair of API responses, use the
fixture workflow below. It is more work per endpoint and answers a
different question.

### Install

Same clone-and-build as the Quick Start above. The fixture commands below
run from inside the MigrateProof checkout.

```sh
npx tsx src/cli/index.ts replay fixtures/checkout-example --version v1
```

### Capture

Record a JSON response in a fixture version slot:

```sh
npx tsx src/cli/index.ts capture fixtures/checkout-example --as v1 --from-file ./v1-response.json
```

`v1-response.json` can be the response body itself, or an object shaped as
`{ "status": 200, "body": { ... } }`. Fixtures are intended to be committed
to git and run in CI. Never capture live endpoints containing customer or
production data.

### Replay

Replay the consumer against a stored response and evaluate its invariant:

```sh
npx tsx src/cli/index.ts replay fixtures/checkout-example --version v1
npx tsx src/cli/index.ts replay fixtures/checkout-example --version v2 --json
```

`v1` passes for the checkout example. `v2` intentionally fails: the API's
`tax` field silently switches from cents (`250`) to dollars (`2.50`)
while `total` stays `2750` — same field name, same JSON type, so a
schema-diff tool would wave it straight through. But `total` no longer
equals `lineItems + tax`, so every order's checkout total silently stops
reconciling against its own line items. That's the gap MigrateProof
exists for: proving your actual code against a real response, not
comparing two schemas.

MigrateProof proves the invariant holds against the _result_ your
consumer code actually returns. If your consumer's own try/catch
swallows a real error and returns a default value that happens to satisfy
the invariant, replay reports a pass — the invariant was checked against
what your code produced, not against whether it produced it correctly.
This is a property of testing real code, not a bug.

### Patch

After a failed v2 replay, ask a configured AI coding agent backend to propose a fix in
an isolated git worktree:

```sh
npx tsx src/cli/index.ts patch fixtures/checkout-example --patch-backend codex
```

#### Backend adapters (`--patch-backend`)

| Backend             | CLI Command    | Notes                                                                   |
| ------------------- | -------------- | ----------------------------------------------------------------------- |
| `codex` _(default)_ | `codex`        | Uses `codex exec --sandbox workspace-write`                             |
| `claude`            | `claude`       | Claude Code CLI with `--permission-mode bypassPermissions`; host access |
| `gemini`            | `gemini`       | Gemini CLI with `--yolo`                                                |
| `copilot`           | `copilot`      | GitHub Copilot CLI with `--allow-all-tools`                             |
| `opencode`          | `opencode`     | OpenCode with positional prompt and `--dir`/`--auto`                    |
| `cursor-agent`      | `cursor-agent` | Built from documented CLI syntax; not live-tested                       |

Install and authenticate the chosen CLI yourself. Only Codex has the small
synthetic live evaluation described above; the remaining adapters have
automated wrapper tests, not verified live repair results. A Git worktree
keeps proposed edits separate but does not sandbox agent commands.

MigrateProof runs all backends under a bounded timeout wrapper (default 10 minutes, configurable via `MIGRATEPROOF_BACKEND_TIMEOUT_MS`), then reruns the v2 replay in that worktree and reports whether the proposal is accepted. It never merges a patch automatically.

- **Rejected** (rerun still fails): the worktree is removed automatically.
- **Timeout or uncertain shutdown:** the worktree is retained. Stop the backend before
  removing it; a timeout cannot guarantee that an escaped process has stopped.
- **Accepted** (rerun passes): the worktree is left on disk and the CLI
  prints its path plus the exact next steps:

  ```sh
  cd "<printed worktree path>"
  git diff HEAD
  # merge the change into your branch, then:
  git worktree remove --force "<printed worktree path>"
  ```

  Accepted worktrees are not garbage-collected — if you run `patch`
  repeatedly, use `git worktree list` and remove each reviewed worktree
  explicitly. `git worktree prune` removes stale metadata, not live worktrees.

### Fixture format

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

#### V1: auto-extracted invariants

`invariant-extraction` can generate `invariant.ts` automatically from a consumer test file's existing `expect(...)` assertions, instead of writing the predicate by hand. In scope: `expect(<propertyAccessChain>).toBe(<literal>)` and `.toEqual(<literal>)`, where `<propertyAccessChain>` is rooted at the captured result variable (e.g. `result.total`, `result.items[0].price`) and the matcher's argument is itself a literal (number, string, boolean, or `null`). Out of scope, and logged as skipped rather than silently dropped: custom matchers, `toHaveProperty`, `toThrow`, async assertion helpers, multi-statement setup, and any matcher argument that isn't a literal (e.g. a variable reference). A human writes `invariant.ts` by hand for anything skipped, exactly as every fixture already requires without auto-extraction.

#### V1: Python impact analysis prerequisite

Python-based impact analysis (`py/impact_analysis.py`) requires Python 3.x on `PATH`. If it isn't found, the command fails with: `python3 not found on PATH — required for Python impact analysis`. This is only required when using Python-specific impact analysis — TypeScript impact analysis (`src/ast/ts/`) has no Python dependency.

#### V1: Docker sandbox residual limitation

This note describes the separate Docker sandbox runner, not the current
fixture `patch` command, which runs its configured coding agent on the host
in a Git worktree. The sandbox runner installs consumer dependencies with
`npm ci --ignore-scripts`, which blocks lifecycle scripts for
npm-registry-sourced packages. A git-sourced dependency's own `prepare`
script remains an upstream limitation of `--ignore-scripts`. Native Windows
is not supported for the Docker sandbox; use WSL2.

### Archived: unsupported GitHub Action example

> **Archived and unsupported; do not copy or expect this to run.** This legacy
> example relies on files from the MigrateProof checkout and cannot run in a
> consumer repository. The code is retained for historical reference only.

Historical example:

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
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm ci
      - run: npx tsx src/cli/index.ts replay --all --version v2 --json > migrateproof-result.json
      - if: always()
        run: node .github/scripts/annotate.js migrateproof-result.json
```

The historical Action replays stored v2 fixtures. It does not monitor a live API or
automatically discover new production breaks.

The historical workflow uses `pull_request`, not `pull_request_target` — fork PRs never get access to repository secrets, even though fixture code executes in-process during replay.

## Developing MigrateProof itself

Activate a Python 3 virtual environment for the impact-analysis tests, and
start Docker before running the complete gate. See [CONTRIBUTING.md](CONTRIBUTING.md).

```sh
source "/path/to/your/python-venv/bin/activate"
npm ci
npm run format
npm run lint
npm run typecheck
npm test               # everything except the Docker sandbox suite
npm run test:sandbox   # the Docker sandbox suite only; needs Docker running
npm run package:smoke  # installs the built tarball into a temporary project
npm run build
```

`npm run test:all` runs both test commands. The Docker suite exercises the
separate sandbox runner and resource cleanup, not the host-based fixture
`patch` command. CI runs the complete gate. Default test parallelism remains
capped at four forks; the Docker suite runs with one. The `runScanFix`
integration suite and the init/capture/replay integration case allow 30
seconds per case for real subprocess work. These are test-only deadlines,
not changes to production process timeouts.

The sandbox suite **skips** rather than fails when Docker is not running. A
green run with Docker closed is not the same as a passing run; check the
skip count before believing it.

### Optional repair and platform checks

After `npm run build`, run the synthetic repair evaluator without an AI call:

```sh
node scripts/live-backend-smoke.mjs --dry-run
```

This uses predetermined repairs and checks held-out inputs; it does not
measure model quality. **Opt-in paid check:** replacing `--dry-run` with
`--live` invokes your authenticated Codex CLI up to three times and may use
paid quota. Neither mode is a default CI gate. Synthetic repositories and
results are retained in the printed temporary directory for inspection.

On a native Windows host, run:

```sh
node scripts/windows-smoke.mjs
```

This checks npm dispatch, literal arguments, owned process-tree termination
and a stubbed source repair (including alternate-case roots on Windows).
On another platform, `--allow-non-windows`
checks only the harness and explicitly reports `nativeWindows: false`.
Neither mode calls a live AI agent or verifies the Docker sandbox on Windows.
