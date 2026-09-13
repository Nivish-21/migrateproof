import { describe, expect, it } from "vitest";
import { normalizeEndpointUrl } from "../../src/mutation/observe.js";

describe("normalizeEndpointUrl", () => {
  // Projects that spin up an in-process server per test (octokit/request does
  // this) bind a random free port each run. The port is an artefact of the
  // run, not part of the endpoint's identity, so keying on it splits one
  // logical endpoint into a new one on every execution.
  it("drops the port for localhost so an ephemeral port is not part of the identity", () => {
    expect(normalizeEndpointUrl("http://localhost:54321/repos/x")).toBe(
      normalizeEndpointUrl("http://localhost:54322/repos/x"),
    );
  });

  it("drops the port for 127.0.0.1 too", () => {
    expect(normalizeEndpointUrl("http://127.0.0.1:8931/foo")).toBe(
      normalizeEndpointUrl("http://127.0.0.1:41234/foo"),
    );
  });

  it("keeps the path, query, method-relevant parts intact", () => {
    expect(normalizeEndpointUrl("http://localhost:5000/a/b?c=1")).toContain(
      "/a/b",
    );
    expect(normalizeEndpointUrl("http://localhost:5000/a/b?c=1")).toContain(
      "c=1",
    );
  });

  // A non-loopback host on a specific port may genuinely be a different
  // service, so the port must be preserved there.
  it("preserves the port for a real remote host", () => {
    expect(normalizeEndpointUrl("https://api.example.com:8443/v1")).not.toBe(
      normalizeEndpointUrl("https://api.example.com:9443/v1"),
    );
  });

  it("leaves a normal https URL unchanged in substance", () => {
    const out = normalizeEndpointUrl("https://api.example.com/v1/orders/123");
    expect(out).toContain("api.example.com");
    expect(out).toContain("/v1/orders/123");
  });

  it("returns the input unchanged when it is not a parseable URL", () => {
    expect(normalizeEndpointUrl("not a url")).toBe("not a url");
  });
});
