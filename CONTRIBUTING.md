# Contributing

## Run checks locally

Activate a Python 3 virtual environment first; the test suite invokes
`python3` for Python impact-analysis coverage. Replace the placeholder with
your environment's path. Docker must be running for the sandbox suite.

```sh
source /path/to/your/python-venv/bin/activate
npm ci
docker info
npm run format
npm run lint
npm run typecheck
npm run test:all
npm run package:smoke
npm run build
```

These are the CI gates. `npm run test:all` includes the Docker sandbox suite;
that suite skips when Docker is unavailable, and a skip is not a pass. Check
the test output and rerun with Docker running before treating the gate as
green.

## Add a fixture

Create `fixtures/<name>/fixture.yaml` with `schemaVersion: 1`, a name, and a
fixed request method and URL. Add `consumer.ts` as a default-exported async
function and `invariant.ts` as a default-exported predicate, then set their
relative paths in `fixture.yaml`. Record or add both `responses.v1` and
`responses.v2`, and include a focused replay test when adding behaviour beyond
the checkout example.

Do not put real customer or production data in fixtures: they are intended for
git and CI.
