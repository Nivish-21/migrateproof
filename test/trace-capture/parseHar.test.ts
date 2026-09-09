import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHar } from "../../src/trace-capture/parseHar.js";
import { UsageError } from "../../src/errors.js";

function writeHar(dir: string, entries: unknown[]): string {
  const path = join(dir, "capture.har");
  writeFileSync(path, JSON.stringify({ log: { entries } }));
  return path;
}

function entry(url: string, status: number, bodyText: string, method = "GET") {
  return {
    request: { method, url },
    response: { status, content: { text: bodyText } },
  };
}

describe("parseHar", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mp-har-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("maps method/url/status/body for a single matching entry", () => {
    const path = writeHar(dir, [
      entry(
        "https://api.example.com/v1/orders/123",
        200,
        JSON.stringify({ total: 2750 }),
      ),
    ]);
    const result = parseHar(path, "v1", "orders/123");
    expect(result).toEqual({
      request: { method: "GET", url: "https://api.example.com/v1/orders/123" },
      response: { status: 200, body: { total: 2750 } },
    });
  });

  it("throws UsageError naming the filter and file on zero matches", () => {
    const path = writeHar(dir, [
      entry("https://api.example.com/v1/other", 200, "{}"),
    ]);
    expect(() => parseHar(path, "v1", "orders/123")).toThrow(UsageError);
    try {
      parseHar(path, "v1", "orders/123");
    } catch (error) {
      expect((error as Error).message).toContain("orders/123");
      expect((error as Error).message).toContain(path);
    }
  });

  it("throws UsageError on zero matches when the .har file has zero entries at all", () => {
    const path = writeHar(dir, []);
    expect(() => parseHar(path, "v1", "orders/123")).toThrow(UsageError);
  });

  it("uses the first match and warns on multiple matches", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const path = writeHar(dir, [
      entry(
        "https://api.example.com/v1/orders/123",
        200,
        JSON.stringify({ total: 1 }),
      ),
      entry(
        "https://api.example.com/v1/orders/1234",
        200,
        JSON.stringify({ total: 2 }),
      ),
    ]);
    const result = parseHar(path, "v1", "orders/123");
    expect(result.response.body).toEqual({ total: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("orders/123");
    warn.mockRestore();
  });

  it("matches case-sensitively", () => {
    const path = writeHar(dir, [
      entry("https://api.example.com/v1/Orders/123", 200, "{}"),
    ]);
    expect(() => parseHar(path, "v1", "orders/123")).toThrow(UsageError);
  });

  it("throws UsageError when the matched entry has no request.method", () => {
    const path = writeHar(dir, [
      {
        request: { url: "https://api.example.com/v1/orders/123" },
        response: { status: 200, content: { text: "{}" } },
      },
    ]);
    expect(() => parseHar(path, "v1", "orders/123")).toThrow(UsageError);
    try {
      parseHar(path, "v1", "orders/123");
    } catch (error) {
      expect((error as Error).message).toContain(
        "incomplete request/response structure",
      );
    }
  });

  it("throws UsageError when the matched entry has no response.status", () => {
    const path = writeHar(dir, [
      {
        request: {
          method: "GET",
          url: "https://api.example.com/v1/orders/123",
        },
        response: { content: { text: "{}" } },
      },
    ]);
    expect(() => parseHar(path, "v1", "orders/123")).toThrow(UsageError);
    try {
      parseHar(path, "v1", "orders/123");
    } catch (error) {
      expect((error as Error).message).toContain(
        "incomplete request/response structure",
      );
    }
  });

  it("throws UsageError when the matched entry has no response.content.text", () => {
    const path = writeHar(dir, [
      {
        request: {
          method: "GET",
          url: "https://api.example.com/v1/orders/123",
        },
        response: { status: 200, content: {} },
      },
    ]);
    expect(() => parseHar(path, "v1", "orders/123")).toThrow(UsageError);
    try {
      parseHar(path, "v1", "orders/123");
    } catch (error) {
      expect((error as Error).message).toContain("no response body recorded");
    }
  });

  it("throws UsageError when response.content.text is not valid JSON", () => {
    const path = writeHar(dir, [
      entry("https://api.example.com/v1/orders/123", 200, "not json"),
    ]);
    expect(() => parseHar(path, "v1", "orders/123")).toThrow(UsageError);
  });

  it("throws UsageError when the file is not valid JSON", () => {
    const path = join(dir, "bad.har");
    writeFileSync(path, "{not json");
    expect(() => parseHar(path, "v1", "orders/123")).toThrow(UsageError);
  });

  it("throws UsageError when JSON is valid but not HAR-shaped", () => {
    const path = join(dir, "notHar.har");
    writeFileSync(path, JSON.stringify({ hello: "world" }));
    expect(() => parseHar(path, "v1", "orders/123")).toThrow(UsageError);
  });

  it("throws UsageError when the file doesn't exist", () => {
    expect(() =>
      parseHar(join(dir, "missing.har"), "v1", "orders/123"),
    ).toThrow(UsageError);
  });
});
