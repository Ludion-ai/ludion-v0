// PUR-4 (+): a diver that is told `purpose_required` sends the request again, once, with the purpose
// its method implies — a write acts — signed, and gets through (spec §11.7). The real gate-node
// middleware on a route that asks for it; the real ludionFetch and diver signer. Never a loop: a
// request that already said something is not sent again, nor a body that cannot be sent twice.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ludionGate } from "../index.mjs";
import { generateSiteKey } from "@ludion/gate-core";
import { createDiverSigner, ludionFetch, generateEd25519 } from "@ludion/diver";

const AGENT = "https://dvr-aaaaaaaaaaaaaaaa.agents.ludion.test";
let server, port, mw, signer;
const seen = [];

before(async () => {
  const session = await generateEd25519();
  signer = await createDiverSigner({ sessionPrivateJwk: session.privateJwk, signatureAgent: AGENT });
  server = http.createServer((req, res) => mw(req, res, () => {
    seen.push({ method: req.method, class: req.ludion.cls.class, purpose: req.ludion.cls.purpose ?? null });
    res.writeHead(200, { "content-type": "text/plain" }); res.end("sent\n");
  }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  mw = await ludionGate({
    siteId: "site-pur4", siteKey: (await generateSiteKey()).privateJwk, authorities: [`127.0.0.1:${port}`],
    routes: [{ match: "/contact", pressure: 2, require: { purpose: "act" } }],
    resolver: { fetch: async () => new Response("", { status: 404 }) }, announce: () => {},
  });
  await mw.gate.resolver.prime({ type: "directory", uri: AGENT }, { keys: [{ ...session.publicJwk, use: "sig" }] });
});
after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));

/** fetch, counting what the agent sends and what comes back. */
function counted() {
  const calls = [];
  const f = async (url, init) => { const r = await fetch(url, init); calls.push({ purpose: init.headers["ludion-purpose"] ?? null, status: r.status, error: r.headers.get("ludion-error") }); return r; };
  return { f, calls };
}

test("PUR-4: told purpose_required, the diver sends the write again once, signed as act, and it goes through", async () => {
  seen.length = 0;
  const { f, calls } = counted();
  const res = await ludionFetch(`http://127.0.0.1:${port}/contact`, { method: "POST", body: "question=stock", headers: { "content-type": "application/x-www-form-urlencoded" } }, { signer, fetch: f });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(calls.map((c) => [c.status, c.error, c.purpose]), [[403, "purpose_required", null], [200, null, "act"]]);
  assert.deepEqual(seen, [{ method: "POST", class: "VERIFIED", purpose: { kind: "act", note: null, signed: true } }], "the site saw one write, in the agent's own signed word");
  console.log("PUR-4: purpose_required → the same write sent once more as act, signed → 200; the site saw it once, VERIFIED");
});

test("PUR-7: never a loop — a request that said something is not sent again, nor a stream body; a read is not asked", async () => {
  const a = counted();
  const r1 = await ludionFetch(`http://127.0.0.1:${port}/contact`, { method: "POST", body: "x", purpose: { kind: "read" } }, { signer, fetch: a.f });
  assert.equal(r1.status, 403);
  assert.equal(a.calls.length, 1, "it said read: the site's answer stands");
  const b = counted();
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("x")); c.close(); } });
  const r2 = await ludionFetch(`http://127.0.0.1:${port}/contact`, { method: "POST", body: stream, duplex: "half" }, { signer, fetch: b.f }).catch((e) => ({ status: `threw ${e.message}` }));
  assert.ok(b.calls.length <= 1, "a stream is not sent twice");
  assert.notEqual(r2.status, 200);
  const c = counted();
  const r3 = await ludionFetch(`http://127.0.0.1:${port}/contact`, {}, { signer, fetch: c.f });
  assert.equal(r3.status, 200);
  assert.equal(c.calls.length, 1, "a read is not asked for a purpose");
});
