import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { join } from "node:path";
import { computeDiff, type DiffEntry } from "../diff/computeDiff.js";
import { UsageError } from "../errors.js";
import { loadFixtureYaml } from "../fixtures/schema.js";
import { loadFixtureModule } from "../invariants/loadFixtureModule.js";

export interface ReplayResult {
  fixture: string;
  version: "v1" | "v2";
  passed: boolean;
  invariant: string;
  diff: DiffEntry[] | null;
  error: string | null;
}

type HttpMethod =
  "delete" | "get" | "head" | "options" | "patch" | "post" | "put";

export async function runReplay(
  fixtureDir: string,
  version: "v1" | "v2",
): Promise<ReplayResult> {
  const fixture = loadFixtureYaml(fixtureDir);
  const response = fixture.responses?.[version];
  if (!response) {
    throw new UsageError(
      `no captured response for version ${version} — run \`migrateproof capture\` first`,
    );
  }
  if (!fixture.invariant || !fixture.consumer) {
    throw new UsageError(
      `fixture ${fixtureDir} has no invariant/consumer set — write invariant.ts/consumer.ts and set the field`,
    );
  }

  const method = fixture.request.method.toLowerCase() as HttpMethod;
  const handlerFactory = http[method];
  if (!handlerFactory) {
    throw new UsageError(
      `unsupported fixture request method: ${fixture.request.method}`,
    );
  }
  const server = setupServer(
    handlerFactory(
      fixture.request.url,
      () =>
        new HttpResponse(JSON.stringify(response.body) ?? null, {
          status: response.status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  server.listen({ onUnhandledRequest: "error" });

  try {
    const consumer = await loadFixtureModule<() => unknown | Promise<unknown>>(
      join(fixtureDir, fixture.consumer),
    );
    const invariant = await loadFixtureModule<
      (result: unknown) => boolean | Promise<boolean>
    >(join(fixtureDir, fixture.invariant));
    const result = await consumer();

    try {
      if (await invariant(result)) {
        return {
          fixture: fixture.name,
          version,
          passed: true,
          invariant: fixture.name,
          diff: null,
          error: null,
        };
      }
    } catch (error) {
      return {
        fixture: fixture.name,
        version,
        passed: false,
        invariant: fixture.name,
        diff: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      fixture: fixture.name,
      version,
      passed: false,
      invariant: fixture.name,
      diff: computeDiff(
        fixture.responses?.v1?.body,
        fixture.responses?.v2?.body,
      ),
      error: null,
    };
  } finally {
    server.close();
  }
}
