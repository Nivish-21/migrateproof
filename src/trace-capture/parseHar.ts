import { readFileSync } from "node:fs";
import { UsageError } from "../errors.js";

interface HarEntry {
  request?: { method?: unknown; url?: unknown };
  response?: { status?: unknown; content?: { text?: unknown } };
}

export interface ParsedHarResult {
  request: { method: string; url: string };
  response: { status: number; body: unknown };
}

export function parseHar(
  harPath: string,
  _version: "v1" | "v2",
  urlFilter: string,
): ParsedHarResult {
  let raw: string;
  try {
    raw = readFileSync(harPath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Unable to read ${harPath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${harPath} is not valid JSON: ${message}`);
  }

  const entries = (parsed as { log?: { entries?: unknown } })?.log?.entries;
  if (!Array.isArray(entries)) {
    throw new UsageError(
      `${harPath} is not HAR-shaped: expected a top-level "log.entries" array`,
    );
  }

  const matches = (entries as HarEntry[]).filter((e) => {
    const url = e.request?.url;
    return typeof url === "string" && url.includes(urlFilter);
  });

  if (matches.length === 0) {
    throw new UsageError(
      `no entry in ${harPath} matched --url-filter "${urlFilter}"`,
    );
  }
  if (matches.length > 1) {
    console.warn(
      `${matches.length} entries in ${harPath} matched --url-filter "${urlFilter}"; using the first`,
    );
  }

  const match = matches[0];
  const method = match.request?.method;
  const url = match.request?.url;
  const status = match.response?.status;
  const bodyText = match.response?.content?.text;

  if (typeof method !== "string" || typeof status !== "number") {
    throw new UsageError(
      `matched request (${String(url)}) in ${harPath} has an incomplete request/response structure (missing method or status)`,
    );
  }

  if (typeof bodyText !== "string") {
    throw new UsageError(
      `matched request (${String(url)}) in ${harPath} has no response body recorded (mid-flight capture)`,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `matched request (${String(url)}) in ${harPath} has a non-JSON response body: ${message}`,
    );
  }

  return {
    request: { method, url: String(url) },
    response: { status, body },
  };
}
