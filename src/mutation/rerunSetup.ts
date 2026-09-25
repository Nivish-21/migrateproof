import { writeFileSync } from "node:fs";

const configRaw = process.env.MIGRATEPROOF_MUTATION_CONFIG;
const resultPath = process.env.MIGRATEPROOF_MUTATION_RESULT_PATH;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

interface MutationConfig {
  method: string;
  url: string;
  mutatedBody: unknown;
}

function matchesUrl(actualUrl: string, targetUrl: string): boolean {
  try {
    const actual = new URL(actualUrl, "https://placeholder");
    const target = new URL(targetUrl, "https://placeholder");
    const ignoresPort = LOOPBACK_HOSTS.has(actual.hostname);
    return (
      actual.hostname === target.hostname &&
      actual.pathname === target.pathname &&
      actual.search === target.search &&
      (ignoresPort || actual.port === target.port)
    );
  } catch {
    return false;
  }
}

function requestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

function requestMethod(input: unknown, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input && typeof input === "object" && "method" in input) {
    return String((input as { method: unknown }).method).toUpperCase();
  }
  return "GET";
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
      ): Promise<Response> {
        if (
          matchesUrl(requestUrl(input), config.url) &&
          requestMethod(input, init) === targetMethod
        ) {
          let originalStatus = 200;
          let originalStatusText = "OK";
          const originalHeaders = new Headers();
          try {
            const response = await (
              fn as (...args: unknown[]) => Promise<Response>
            ).call(this, input, init);
            originalStatus = response.status;
            originalStatusText = response.statusText;
            for (const [key, value] of response.headers.entries()) {
              originalHeaders.set(key, value);
            }
          } catch {
            // The intercepted response intentionally replaces a failed live call.
          }
          originalHeaders.set("content-type", "application/json");
          const response = new Response(JSON.stringify(config.mutatedBody), {
            status: originalStatus,
            statusText: originalStatusText,
            headers: originalHeaders,
          });
          if (resultPath) writeFileSync(resultPath, '{"served":true}');
          return response;
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

    let activeFetch = wrap(globalThis.fetch) as typeof globalThis.fetch;
    try {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        enumerable: true,
        get() {
          return activeFetch;
        },
        set(newFetch) {
          activeFetch = wrap(newFetch) as typeof globalThis.fetch;
        },
      });
    } catch {
      // A non-configurable fetch still remains wrapped through the initial value.
    }
  } catch {
    // Malformed configuration must not crash the target suite; no marker means incomplete.
  }
}
