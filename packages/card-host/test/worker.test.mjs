// The Card Host Worker when the Registry cannot answer: a clean 503 (no-store, Retry-After) that says
// so — not "unknown agent" (404) for an agent that exists, and not the platform's error page.
// An agent the Registry does not know is still 404.
import { test } from "node:test";
import assert from "node:assert/strict";
import cardWorker from "../worker.mjs";

const HOST = "dvr-aaaaaaaaaaaaaaaa.agents.ludion.ai";
const ns = (fetch) => ({ REGISTRY: { idFromName: (n) => n, get: () => ({ fetch }) } });
const ask = (env, p = "/card") => cardWorker.fetch(new Request(`https://${HOST}${p}`), env);

test("card host: a Registry that fails or cannot be reached is 503 registry_unavailable (no-store, Retry-After); an unknown agent is still 404", async () => {
  for (const [name, env] of [
    ["the Registry answers 500", ns(async () => new Response("{}", { status: 500 }))],
    ["the Registry answers 503", ns(async () => new Response("{}", { status: 503 }))],
    ["the Registry cannot be reached", ns(async () => { throw new Error("Durable Object reset"); })],
  ]) {
    for (const p of ["/card", "/client", "/.well-known/http-message-signatures-directory"]) {
      const r = await ask(env, p);
      assert.equal(r.status, 503, `${name}, ${p}`);
      assert.equal((await r.json()).error, "registry_unavailable", `${name}, ${p}`);
      assert.equal(r.headers.get("cache-control"), "no-store", `${name}, ${p}`);
      assert.ok(Number(r.headers.get("retry-after")) > 0, `${name}, ${p}`);
    }
  }
  const unknown = await ask(ns(async () => new Response(JSON.stringify({ error: "unknown_agent" }), { status: 404 })));
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, "unknown_agent");
});
