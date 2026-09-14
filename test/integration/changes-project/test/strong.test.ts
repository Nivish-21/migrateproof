import { afterAll, beforeAll, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { getCharge } from "../src/getCharge.js";

const server = setupServer(
  http.get("http://localhost/charge", () => {
    return HttpResponse.json({
      amount: 1000,
      currency: "usd",
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

it("returns a charge with the exact expected amount", async () => {
  const charge = await getCharge();
  expect(charge.amount).toBe(1000);
});
