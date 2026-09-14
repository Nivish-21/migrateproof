import { describe, expect, it } from "vitest";
import { endpointMatches } from "../../src/changes/matchEndpoint.js";

const call = (method: string, url: string) => ({ method, url });

describe("endpointMatches", () => {
  it("matches an exact path", () => {
    expect(
      endpointMatches(
        call("GET", "https://api.stripe.com/v1/charges"),
        "api.stripe.com",
        "GET /v1/charges",
      ),
    ).toBe(true);
  });

  it("matches a {param} against any single segment", () => {
    expect(
      endpointMatches(
        call("GET", "https://api.stripe.com/v1/charges/ch_3Nk"),
        "api.stripe.com",
        "GET /v1/charges/{id}",
      ),
    ).toBe(true);
  });

  it("does not let {param} span multiple segments", () => {
    expect(
      endpointMatches(
        call("GET", "https://api.stripe.com/v1/charges/ch_3Nk/refunds"),
        "api.stripe.com",
        "GET /v1/charges/{id}",
      ),
    ).toBe(false);
  });

  it("rejects a different host", () => {
    expect(
      endpointMatches(
        call("GET", "https://api.other.com/v1/charges"),
        "api.stripe.com",
        "GET /v1/charges",
      ),
    ).toBe(false);
  });

  it("rejects a different method", () => {
    expect(
      endpointMatches(
        call("POST", "https://api.stripe.com/v1/charges"),
        "api.stripe.com",
        "GET /v1/charges",
      ),
    ).toBe(false);
  });

  it("compares the method case-insensitively", () => {
    expect(
      endpointMatches(
        call("get", "https://api.stripe.com/v1/charges"),
        "api.stripe.com",
        "GET /v1/charges",
      ),
    ).toBe(true);
  });

  it("ignores the query string", () => {
    expect(
      endpointMatches(
        call("GET", "https://api.stripe.com/v1/charges?limit=10"),
        "api.stripe.com",
        "GET /v1/charges",
      ),
    ).toBe(true);
  });

  it("tolerates a trailing slash on either side", () => {
    expect(
      endpointMatches(
        call("GET", "https://api.stripe.com/v1/charges/"),
        "api.stripe.com",
        "GET /v1/charges",
      ),
    ).toBe(true);
  });

  // observe() strips the port from loopback URLs (normalizeEndpointUrl), so a
  // locally-bound test server must still match a localhost changes file.
  it("matches a portless loopback URL", () => {
    expect(
      endpointMatches(
        call("GET", "http://localhost/v1/charges"),
        "localhost",
        "GET /v1/charges",
      ),
    ).toBe(true);
  });

  it("returns false for a URL that will not parse", () => {
    expect(
      endpointMatches(
        call("GET", "not a url"),
        "api.stripe.com",
        "GET /v1/charges",
      ),
    ).toBe(false);
  });

  it("returns false for a malformed pattern with no space", () => {
    expect(
      endpointMatches(
        call("GET", "https://api.stripe.com/v1/charges"),
        "api.stripe.com",
        "/v1/charges",
      ),
    ).toBe(false);
  });
});
