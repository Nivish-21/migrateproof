// src/changes/matchEndpoint.ts
import type { ObservedCall } from "../mutation/observe.js";

export function endpointMatches(
  call: Pick<ObservedCall, "method" | "url">,
  apiHost: string,
  endpointPattern: string,
): boolean {
  const spaceIndex = endpointPattern.indexOf(" ");
  if (spaceIndex === -1) return false;

  const patternMethod = endpointPattern.slice(0, spaceIndex).trim();
  const patternPath = endpointPattern.slice(spaceIndex + 1).trim();
  if (patternMethod.length === 0 || patternPath.length === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(call.url);
  } catch {
    return false;
  }

  if (parsed.hostname !== apiHost) return false;
  if (call.method.toUpperCase() !== patternMethod.toUpperCase()) return false;

  const callSegments = parsed.pathname.split("/").filter((s) => s.length > 0);
  const patternSegments = patternPath.split("/").filter((s) => s.length > 0);

  if (callSegments.length !== patternSegments.length) return false;

  for (let i = 0; i < patternSegments.length; i++) {
    const patternSeg = patternSegments[i]!;
    const callSeg = callSegments[i]!;

    if (patternSeg.startsWith("{") && patternSeg.endsWith("}")) {
      continue;
    }

    if (patternSeg !== callSeg) {
      return false;
    }
  }

  return true;
}
