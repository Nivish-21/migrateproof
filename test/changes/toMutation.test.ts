import { describe, expect, it } from "vitest";
import { toMutation } from "../../src/changes/toMutation.js";
import { applyMutation } from "../../src/mutation/operators.js";

const body = {
  amount: 1000,
  status: "paid",
  customer: { id: "c1", name: "Ada" },
  items: [1, 2],
};

describe("toMutation", () => {
  it("unit-change multiplies by factor", () => {
    const r = toMutation(
      {
        endpoint: "GET /x",
        field: "amount",
        kind: "unit-change",
        factor: 100,
      },
      body,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mutation.after).toBe(100000);
    expect(r.mutation.operator).toBe("numeric-scale");
    expect(applyMutation(body, r.mutation)).toMatchObject({ amount: 100000 });
  });

  it("removed produces a remove-field that deletes the key", () => {
    const r = toMutation(
      { endpoint: "GET /x", field: "customer.name", kind: "removed" },
      body,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = applyMutation(body, r.mutation) as {
      customer: Record<string, unknown>;
    };
    expect("name" in out.customer).toBe(false);
  });

  it("now-nullable nulls a nested field", () => {
    const r = toMutation(
      { endpoint: "GET /x", field: "customer.name", kind: "now-nullable" },
      body,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(applyMutation(body, r.mutation)).toMatchObject({
      customer: { name: null },
    });
  });

  it("type-changed to string coerces", () => {
    const r = toMutation(
      {
        endpoint: "GET /x",
        field: "amount",
        kind: "type-changed",
        toType: "string",
      },
      body,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mutation.after).toBe("1000");
  });

  it("new-enum-value substitutes the value", () => {
    const r = toMutation(
      {
        endpoint: "GET /x",
        field: "status",
        kind: "new-enum-value",
        value: "requires_capture",
      },
      body,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mutation.after).toBe("requires_capture");
    expect(r.mutation.operator).toBe("new-enum-value");
  });

  it("reports a field that is not in the recorded body", () => {
    const r = toMutation(
      { endpoint: "GET /x", field: "nope.deep", kind: "removed" },
      body,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/not present/i);
  });

  it("reports unit-change against a non-numeric field", () => {
    const r = toMutation(
      {
        endpoint: "GET /x",
        field: "status",
        kind: "unit-change",
        factor: 100,
      },
      body,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/not a number/i);
  });

  it("carries the note into the description when present", () => {
    const r = toMutation(
      {
        endpoint: "GET /x",
        field: "amount",
        kind: "unit-change",
        factor: 100,
        note: "now in cents",
      },
      body,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mutation.description).toContain("now in cents");
  });
});
