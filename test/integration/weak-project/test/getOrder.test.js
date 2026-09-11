import { afterAll, beforeAll, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { getOrder } from "../src/getOrder.js";

const server = setupServer(
  http.get("https://api.example.com/orders/123", () => {
    return HttpResponse.json({
      id: "123",
      tax: 250,
      total: 2750,
      lineItems: [{ name: "Item 1", price: 2500 }],
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

it("returns an order", async () => {
  const order = await getOrder();
  expect(order).toBeDefined();
});
