import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";

// Binds a random free port on every run — the pattern octokit/request uses,
// and the one that used to make an endpoint unrecognisable across runs.
let server;
afterEach(() => server?.close());

function startServer() {
  return new Promise((resolve) => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 1, tax: 250, total: 2750 }));
    });
    server.listen(0, () => resolve(server.address().port));
  });
}

// Deliberately weak: never asserts on tax, so mutating it must go unnoticed.
it("fetches an order without checking its fields", async () => {
  const port = await startServer();
  const res = await fetch(`http://localhost:${port}/orders/1`);
  expect(await res.json()).toBeDefined();
});
