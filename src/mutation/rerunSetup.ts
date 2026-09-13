// src/mutation/rerunSetup.ts
// Injected into the target project's test process during the rerun pass.
// Serves the mutated response for the target endpoint.

const configRaw = process.env.MIGRATEPROOF_MUTATION_CONFIG;

interface MutationConfig {
  method: string;
  url: string;
  mutatedBody: unknown;
}

function matchesUrl(actualUrl: string, targetUrl: string): boolean {
  if (actualUrl === targetUrl) return true;
  try {
    const u1 = new URL(actualUrl, "https://placeholder");
    const u2 = new URL(targetUrl, "https://placeholder");
    // Host must agree, so two services that happen to share a path are never
    // confused for each other. The port is deliberately excluded: observe()
    // strips it from loopback URLs (see normalizeEndpointUrl), because a
    // per-test server binds a fresh ephemeral port on every run and the
    // recorded port will never be the one in use during the re-run.
    return u1.hostname === u2.hostname && u1.pathname === u2.pathname;
  } catch {
    return false;
  }
}

if (configRaw) {
  try {
    const config = JSON.parse(configRaw) as MutationConfig;
    const targetMethod = config.method.toUpperCase();

    const wrap = function (fn: unknown): unknown {
      if (
        typeof fn !== "function" ||
        (fn as { __mpRerunWrapped?: boolean }).__mpRerunWrapped
      ) {
        return fn;
      }
      const wrapped = async function (
        this: unknown,
        input: unknown,
        init?: RequestInit,
      ) {
        const rawUrl =
          typeof input === "string"
            ? input
            : input && typeof input === "object" && "url" in input
              ? (input as { url: string }).url
              : String(input);
        const actualMethod = (init?.method ?? "GET").toUpperCase();

        if (matchesUrl(rawUrl, config.url) && actualMethod === targetMethod) {
          let originalStatus = 200;
          let originalStatusText = "OK";
          const originalHeaders = new Headers();

          try {
            const res = await (
              fn as (...args: unknown[]) => Promise<Response>
            ).call(this, input, init);
            originalStatus = res.status;
            originalStatusText = res.statusText;
            for (const [k, v] of res.headers.entries()) {
              originalHeaders.set(k, v);
            }
          } catch {
            // Handler may error or not exist; continue with fallback
          }

          originalHeaders.set("content-type", "application/json");
          return new Response(JSON.stringify(config.mutatedBody), {
            status: originalStatus,
            statusText: originalStatusText,
            headers: originalHeaders,
          });
        }

        return (fn as (...args: unknown[]) => Promise<Response>).call(
          this,
          input,
          init,
        );
      };
      (wrapped as { __mpRerunWrapped?: boolean }).__mpRerunWrapped = true;
      return wrapped;
    };

    const originalDefineProperty = Object.defineProperty;

    Object.defineProperty = function <T>(
      target: T,
      prop: PropertyKey,
      descriptor: PropertyDescriptor & ThisType<unknown>,
    ): T {
      if (
        (target as unknown) === globalThis &&
        prop === "fetch" &&
        descriptor &&
        typeof descriptor.value === "function"
      ) {
        descriptor.value = wrap(descriptor.value);
      }
      return originalDefineProperty(target, prop, descriptor);
    };

    let activeFetch = wrap(globalThis.fetch);
    try {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        enumerable: true,
        get() {
          return activeFetch;
        },
        set(newFetch) {
          activeFetch = wrap(newFetch);
        },
      });
    } catch {
      // If not configurable, already wrapped
    }
  } catch {
    // Config parsing error
  }
}
