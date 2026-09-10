# Security Policy

## Supported versions

MigrateProof is pre-1.0. Security fixes land on `main` and the latest
published npm release only — there are no maintained older versions.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability.

Use [GitHub's private vulnerability reporting](https://github.com/Nivish-21/migrateproof/security/advisories/new)
for this repository (Security tab → "Report a vulnerability"). This opens a
private advisory only the maintainer can see until it's resolved.

Include what you'd include in any report: the affected version, a
reproduction, and the impact you'd expect (what an attacker could actually
do with it).

You should get an initial response within a few days. There's no fixed SLA
— this is a small, pre-1.0 project — but genuine vulnerabilities are treated
as the top priority over any other open work.

## Scope — what's actually security-relevant here

MigrateProof executes real code and real processes as part of what it does.
The realistic attack surface, in order of how directly it can hurt you:

- **`replay` and `patch` execute your fixture's `consumer.ts`/`invariant.ts`
  and the target repo's code.** A malicious or compromised fixture/consumer
  file runs with the same privileges as whoever runs the CLI. Treat fixture
  files with the same trust level as any other code you'd run locally —
  MigrateProof does not sandbox `replay`.
- **`patch`'s sandboxed execution path** (`src/sandbox/runSandboxed.ts`)
  runs the target repo's dependencies and test suite inside a
  network-isolated (`NetworkMode: none`), read-only-root, non-root Docker
  container specifically because that step is the one meant to tolerate
  untrusted/AI-proposed changes. If you find a way to escape that
  container or reach the network/host from inside it, that's a genuine
  vulnerability — report it.
- **All external process invocation** (`git`, `docker`, `python3`) uses
  `execFile` with an argv array, never a shell string built from
  fixture/user content. If you find a code path that builds a shell
  command from fixture or fixture-adjacent input, that's a vulnerability
  class this project explicitly tries to prevent — report it even if you
  can't fully weaponize it.
- **Fixture capture** (`capture`) is documented as unsafe to run against
  live production endpoints containing real customer data — that's a
  usage guideline, not a vulnerability in the tool itself.

Reports about `npm audit` output on transitive dependencies with no
demonstrated impact on MigrateProof itself are still welcome, but will be
triaged lower than the categories above.
