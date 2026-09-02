# Contributing

## Run checks locally

```sh
npm install && npm test
npm run lint
npm run typecheck
npm run build
```

## Add a fixture

Create `fixtures/<name>/fixture.yaml` with `schemaVersion: 1`, a name, and a
fixed request method and URL. Add `consumer.ts` as a default-exported async
function and `invariant.ts` as a default-exported predicate, then set their
relative paths in `fixture.yaml`. Record or add both `responses.v1` and
`responses.v2`, and include a focused replay test when adding behaviour beyond
the checkout example.

Do not put real customer or production data in fixtures: they are intended for
git and CI.
