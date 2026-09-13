// test/mutation/operators.test.ts
import { describe, expect, it } from "vitest";
import {
  applyMutation,
  generateMutations,
  MAX_MUTATIONS_PER_RESPONSE,
  type Mutation,
} from "../../src/mutation/operators.js";

describe("generateMutations", () => {
  it("generates a numeric-scale and a type-flip mutation for each number field", () => {
    const mutations = generateMutations({ tax: 250 });
    const operators = mutations.map((m) => m.operator);
    expect(operators).toContain("numeric-scale");
    expect(operators).toContain("type-flip");
  });

  it("scales a number by /100 to model a cents-to-dollars change", () => {
    const mutations = generateMutations({ tax: 250 });
    const scale = mutations.find((m) => m.operator === "numeric-scale");
    expect(scale?.before).toBe(250);
    expect(scale?.after).toBe(2.5);
  });

  it("flips a number to its string form", () => {
    const mutations = generateMutations({ tax: 250 });
    const flip = mutations.find((m) => m.operator === "type-flip");
    expect(flip?.after).toBe("250");
  });

  it("generates null-field and remove-field mutations for every field", () => {
    const mutations = generateMutations({ name: "x" });
    const operators = mutations.map((m) => m.operator);
    expect(operators).toContain("null-field");
    expect(operators).toContain("remove-field");
  });

  it("generates an empty-array mutation for a non-empty array field", () => {
    const mutations = generateMutations({ items: [1, 2] });
    const empty = mutations.find((m) => m.operator === "empty-array");
    expect(empty?.fieldPath).toBe("items");
    expect(empty?.after).toEqual([]);
  });

  it("uses dot paths for nested fields", () => {
    const mutations = generateMutations({ order: { tax: 250 } });
    expect(mutations.some((m) => m.fieldPath === "order.tax")).toBe(true);
  });

  it("returns no mutations for a non-object body", () => {
    expect(generateMutations("plain string")).toEqual([]);
    expect(generateMutations(null)).toEqual([]);
  });
});

describe("applyMutation", () => {
  it("applies a mutation without mutating the original object", () => {
    const original = { tax: 250 };
    const mutation: Mutation = {
      operator: "numeric-scale",
      fieldPath: "tax",
      before: 250,
      after: 2.5,
      description: "tax: 250 -> 2.5 (numeric scale)",
    };
    const result = applyMutation(original, mutation) as { tax: number };
    expect(result.tax).toBe(2.5);
    expect(original.tax).toBe(250);
  });

  it("applies a nested mutation by dot path", () => {
    const result = applyMutation(
      { order: { tax: 250 } },
      {
        operator: "null-field",
        fieldPath: "order.tax",
        before: 250,
        after: null,
        description: "order.tax: 250 -> null",
      },
    ) as { order: { tax: null } };
    expect(result.order.tax).toBeNull();
  });

  it("deletes the key entirely for remove-field", () => {
    const result = applyMutation(
      { tax: 250, total: 2750 },
      {
        operator: "remove-field",
        fieldPath: "tax",
        before: 250,
        after: undefined,
        description: "tax removed",
      },
    ) as Record<string, unknown>;
    expect("tax" in result).toBe(false);
    expect(result.total).toBe(2750);
  });
});

describe("mutation count cap", () => {
  // A scan spawns the target's test runner once per mutation, so an
  // uncapped set is a direct CPU multiplier on someone else's machine.
  const wideBody = {
    id: 1296269,
    name: "Hello-World",
    full_name: "octocat/Hello-World",
    private: false,
    owner: { login: "octocat", id: 1, type: "User", site_admin: false },
    description: "This your first repo!",
    fork: false,
    forks_count: 9,
    stargazers_count: 80,
    watchers_count: 80,
    size: 108,
    open_issues_count: 0,
    topics: ["octocat", "atom"],
    has_issues: true,
    archived: false,
  };

  it("caps mutations so one response cannot trigger dozens of test-suite runs", () => {
    expect(generateMutations(wideBody).length).toBeLessThanOrEqual(
      MAX_MUTATIONS_PER_RESPONSE,
    );
  });

  it("keeps numeric-scale, the highest-value operator, when the cap applies", () => {
    const mutations = generateMutations(wideBody);
    expect(mutations.some((m) => m.operator === "numeric-scale")).toBe(true);
  });

  it("spreads the cap across operators instead of spending it all on one", () => {
    const distinct = new Set(
      generateMutations(wideBody).map((m) => m.operator),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("returns everything when a small response is under the cap", () => {
    const mutations = generateMutations({ tax: 250 });
    expect(mutations.length).toBeLessThan(MAX_MUTATIONS_PER_RESPONSE);
    expect(mutations.some((m) => m.operator === "remove-field")).toBe(true);
  });
});
