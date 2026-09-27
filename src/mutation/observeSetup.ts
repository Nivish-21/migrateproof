// src/mutation/observeSetup.ts
// Injected into the target project's test process via NODE_OPTIONS.
// Records traffic; never modifies responses during the observe pass.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const recordingPath = process.env.MIGRATEPROOF_RECORDING_PATH;

function findTouchingTest(): string {
  try {
    const globalExpect = (
      globalThis as unknown as {
        expect?: { getState?: () => { testPath?: string } };
      }
    ).expect;
    const testPath = globalExpect?.getState?.()?.testPath;
    if (testPath) return testPath;
  } catch {
    // ignore
  }

  const stack = new Error().stack ?? "";
  const match = stack.match(
    /(?:\(|^\s*at\s+(?:async\s+)?)((?:file:\/\/|\/|[A-Za-z]:[\\/]|\\\\).+\.(?:test|spec)\.[cm]?[jt]sx?):\d+:\d+\)?$/im,
  );
  if (match && match[1]) {
    return match[1].startsWith("file:") ? fileURLToPath(match[1]) : match[1];
  }
  return "";
}

function wrap(fn: unknown): unknown {
  if (
    typeof fn !== "function" ||
    (fn as { __mpWrapped?: boolean }).__mpWrapped
  ) {
    return fn;
  }
  const wrapped = async function (
    this: unknown,
    input: unknown,
    init?: RequestInit,
  ) {
    const response = await (
      fn as (...args: unknown[]) => Promise<Response>
    ).call(this, input, init);
    try {
      const clone = response.clone();
      const body: unknown = await clone.json();
      const touchingTest = findTouchingTest();
      const rawUrl =
        typeof input === "string"
          ? input
          : input && typeof input === "object" && "url" in input
            ? (input as { url: string }).url
            : String(input);
      const method = init?.method
        ? init.method
        : input && typeof input === "object" && "method" in input
          ? String((input as { method: unknown }).method)
          : "GET";

      if (recordingPath) {
        appendFileSync(
          `${recordingPath}.jsonl`,
          `${JSON.stringify({
            method: method.toUpperCase(),
            url: rawUrl,
            status: response.status,
            body,
            touchingTest,
          })}\n`,
        );
      }
    } catch {
      // Non-JSON response — out of scope for the starter mutation set.
    }
    return response;
  };
  (wrapped as { __mpWrapped?: boolean }).__mpWrapped = true;
  return wrapped;
}

if (recordingPath) {
  const originalDefineProperty = Object.defineProperty;

  // 1. Intercept Object.defineProperty for fetch (MSW / @mswjs/interceptors)
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

  // 2. Intercept direct assignment to globalThis.fetch (hand-rolled fetch stubs)
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
    // If not configurable, activeFetch wrapper was already applied
  }
}
