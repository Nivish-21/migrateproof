import { describe, expect, it } from "vitest";
import { parseChangesFile } from "../../src/changes/schema.js";
import { UsageError } from "../../src/errors.js";

const valid = JSON.stringify({
  api: "api.stripe.com",
  source: "https://stripe.com/docs/upgrades",
  changes: [
    {
      endpoint: "GET /v1/charges/{id}",
      field: "amount",
      kind: "unit-change",
      factor: 100,
    },
    {
      endpoint: "GET /v1/charges/{id}",
      field: "customer.name",
      kind: "removed",
    },
  ],
});

describe("parseChangesFile", () => {
  it("parses a valid file", () => {
    const result = parseChangesFile(valid, "c.json");
    expect(result.api).toBe("api.stripe.com");
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]?.factor).toBe(100);
  });

  it("converts to-type into toType", () => {
    const raw = JSON.stringify({
      api: "a.com",
      changes: [
        {
          endpoint: "GET /x",
          field: "f",
          kind: "type-changed",
          "to-type": "string",
        },
      ],
    });
    expect(parseChangesFile(raw, "c.json").changes[0]?.toType).toBe("string");
  });

  it("throws UsageError on malformed JSON, naming the file", () => {
    expect(() => parseChangesFile("{ not json", "c.json")).toThrow(UsageError);
    expect(() => parseChangesFile("{ not json", "c.json")).toThrow(/c\.json/);
  });

  it("throws UsageError when api is missing", () => {
    expect(() =>
      parseChangesFile(JSON.stringify({ changes: [] }), "c.json"),
    ).toThrow(UsageError);
  });

  it("throws UsageError naming the index of an unknown kind", () => {
    const raw = JSON.stringify({
      api: "a.com",
      changes: [
        { endpoint: "GET /x", field: "f", kind: "removed" },
        { endpoint: "GET /y", field: "g", kind: "teleported" },
      ],
    });
    expect(() => parseChangesFile(raw, "c.json")).toThrow(/changes\[1\]/);
    expect(() => parseChangesFile(raw, "c.json")).toThrow(/teleported/);
  });

  it("throws when unit-change has no factor", () => {
    const raw = JSON.stringify({
      api: "a.com",
      changes: [{ endpoint: "GET /x", field: "f", kind: "unit-change" }],
    });
    expect(() => parseChangesFile(raw, "c.json")).toThrow(/factor/);
  });

  it("throws when unit-change factor is zero", () => {
    const raw = JSON.stringify({
      api: "a.com",
      changes: [
        { endpoint: "GET /x", field: "f", kind: "unit-change", factor: 0 },
      ],
    });
    expect(() => parseChangesFile(raw, "c.json")).toThrow(/factor/);
  });

  it("throws when type-changed has no to-type", () => {
    const raw = JSON.stringify({
      api: "a.com",
      changes: [{ endpoint: "GET /x", field: "f", kind: "type-changed" }],
    });
    expect(() => parseChangesFile(raw, "c.json")).toThrow(/to-type/);
  });

  it("accepts new-enum-value carrying an explicit null", () => {
    const raw = JSON.stringify({
      api: "a.com",
      changes: [
        {
          endpoint: "GET /x",
          field: "f",
          kind: "new-enum-value",
          value: null,
        },
      ],
    });
    expect(parseChangesFile(raw, "c.json").changes).toHaveLength(1);
  });

  it("throws when new-enum-value omits value entirely", () => {
    const raw = JSON.stringify({
      api: "a.com",
      changes: [{ endpoint: "GET /x", field: "f", kind: "new-enum-value" }],
    });
    expect(() => parseChangesFile(raw, "c.json")).toThrow(/value/);
  });

  it("throws when changes is absent or not an array", () => {
    expect(() =>
      parseChangesFile(JSON.stringify({ api: "a.com" }), "c.json"),
    ).toThrow(UsageError);
  });
});
