// LEAK-1 (±): the Registry keeps no contact (the human's decision, 2026-10-05). An operator's contact
// reaches the Registry inside its signed registration; REG-7 counts it under a hash and it goes no
// further. Through the production Worker and its Durable Object (with the production limits on),
// registrations carrying canary contacts — a first registration, a newer one with another contact, a
// revoked agent — leave the canary in nothing the Registry stores or serves: every stored value, the
// bulk copy (its JWS payload decoded), the Card Host's card and client document, the public record the
// Card Host reads, a Staple. The judge also reads base64url (a stored signed statement would hold the
// contact encoded), in any case.
// The other side: a planted Registry that keeps the raw statement, and a planted Card Host that puts the
// contact on the card, are caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import registryWorker, { RegistryState } from "../worker.mjs";
import { memoryStorage } from "../src/durable.mjs";
import cardWorker from "../../../packages/card-host/worker.mjs";
import { diverStore } from "./support.mjs";
import { createRegistryClient, signRootStatement, cardDocument } from "@ludion/diver";
import { generateRegistryKey } from "@ludion/gate-core/staple";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROD = JSON.parse(fs.readFileSync(path.join(HERE, "..", "wrangler.json"), "utf8")).vars;
const ORIGIN = "https://registry.ludion.ai";

/** Every way `text` could hold `canary`: as written, any case, inside base64url runs (a signed statement). */
export function leakProblems(texts, canaries) {
  const out = [];
  const decoded = (t) => [...String(t).matchAll(/[A-Za-z0-9_-]{16,}/g)].map((m) => { try { return Buffer.from(m[0], "base64url").toString("utf8"); } catch { return ""; } });
  for (const [where, t] of texts) {
    const all = [String(t), ...decoded(t)].join("\n").toLowerCase();
    for (const c of canaries) if (all.includes(c.toLowerCase())) out.push(`${where} holds ${c}`);
  }
  return out;
}

async function world({ storage = memoryStorage() } = {}) {
  const key = await generateRegistryKey();
  const env = { REGISTRY_SIGNING_KEY: JSON.stringify(key.privateJwk), REGISTRY_ORIGIN: ORIGIN, REGISTRY_ISSUER: ORIGIN, ...PROD };
  const durable = new RegistryState({ storage }, env);
  const ns = { REGISTRY: { idFromName: (n) => n, get: () => durable } };
  const seen = [];
  const via = async (url, init) => { const r = await registryWorker.fetch(new Request(url, init), ns); seen.push([`${init?.method ?? "GET"} ${new URL(url).pathname}`, await r.clone().text()]); return r; };
  return { storage, ns, durable, via, seen, client: createRegistryClient({ url: ORIGIN, fetch: via }) };
}

async function register(w, d, contact, ip, iatBump = 0) {
  const statement = signRootStatement(d.root, "ludion-register+jwt", {
    sub: d.store.diver_id, root: { kty: "OKP", crv: "Ed25519", x: d.root.x }, signature_agent: d.store.signature_agent,
    name: d.store.name, contacts: [contact], iat: Math.floor(Date.now() / 1000) + iatBump,
  });
  const r = await w.via(`${ORIGIN}/v0/divers`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ statement }) });
  assert.ok(r.status === 201 || r.status === 200, `${r.status} ${await r.text()}`);
}

/** Run the scenario; everything the Registry stores or serves, as [where, text]. */
async function everything(w, canaries) {
  const agents = [];
  for (const [i, name] of ["LEAK-1 A", "LEAK-1 B"].entries()) {
    const d = await diverStore(name);
    d.store.signature_agent = `https://${d.store.diver_id}.agents.ludion.ai`;
    await register(w, d, canaries[i], `203.0.113.${i + 1}`);
    await w.client.approveKeys(d.store, d.root, [{ kty: "OKP", crv: "Ed25519", x: d.session.x }]);
    agents.push(d);
  }
  await register(w, agents[0], canaries[2], "203.0.113.1", 5); // registered again, with another contact
  const staple = await w.client.staple(agents[0].store, agents[0].session);
  await w.client.revoke(agents[1].store, agents[1].root, { reason: "retired" });
  const texts = [["a Staple", staple.staple]];
  for (const [k, v] of await w.storage.list({ prefix: "" })) texts.push([`stored ${k}`, JSON.stringify(v)]);
  const bulk = await (await w.via(`${ORIGIN}/v0/bulk?since=0`)).json();
  texts.push(["the bulk copy", JSON.stringify(bulk)]);
  for (const d of agents) {
    const host = `${d.store.diver_id}.agents.ludion.ai`;
    for (const p of ["/card", "/client", "/.well-known/http-message-signatures-directory"]) texts.push([`${host}${p}`, await (await cardWorker.fetch(new Request(`https://${host}${p}`), w.ns)).text()]);
    texts.push([`public record ${d.store.diver_id}`, await (await w.durable.fetch(new Request(`https://registry.internal/__card/${d.store.diver_id}`))).text()]);
  }
  for (const [where, body] of w.seen) texts.push([`response to ${where}`, body]);
  return { texts, agents };
}

const canaries = () => { const r = Math.random().toString(36).slice(2, 10); return [`mailto:leak1-a-${r}@canary.example`, `mailto:LEAK1-B-${r}+hn@Canary.Example`, `mailto:leak1-again-${r}@canary.example`]; };
const address = (c) => c.replace(/^mailto:/i, "");

test("LEAK-1: the Registry keeps no contact — nothing it stores or serves holds one, encoded or not", async () => {
  const c = canaries();
  const w = await world();
  const { texts, agents } = await everything(w, c);
  assert.ok(texts.length > 15, `what was read: ${texts.length}`);
  // The scenario did what it says: both registered, one revoked, the card served.
  const card = JSON.parse(texts.find(([k]) => k === `${agents[0].store.diver_id}.agents.ludion.ai/card`)[1]);
  assert.equal(card.client_id, `https://${agents[0].store.diver_id}.agents.ludion.ai/card`);
  assert.deepEqual(card.contacts, [], "the card has no contacts");
  assert.deepEqual(leakProblems(texts, c.map(address)), []);
  console.log(`LEAK-1: 3 registrations with canary contacts (one again, one revoked) through the production Worker; ${texts.length} stored values, responses, cards, client documents and the bulk copy hold none, plain or encoded`);
});

test("LEAK-1: a Registry that keeps the signed statement, and a card that shows the contact, are caught", async () => {
  const c = canaries();
  // A Registry whose store also keeps every request body it was sent (the raw signed statement).
  const storage = memoryStorage();
  const w = await world({ storage });
  const realFetch = w.durable.fetch.bind(w.durable);
  w.durable.fetch = async (req) => { if (req.method === "POST") await storage.put(`raw:${Math.random()}`, await req.clone().text()); return realFetch(req); };
  const { texts } = await everything(w, c);
  assert.ok(leakProblems(texts, c.map(address)).some((p) => /stored raw:/.test(p)), "the kept statement (base64url) is caught");
  // A Card Host that puts the contact on the card.
  const leaky = cardDocument({ origin: "https://dvr-aaaaaaaaaaaaaaaa.agents.ludion.ai", name: "x", contacts: [c[0]] });
  assert.ok(leakProblems([["a planted card", JSON.stringify(leaky)]], [address(c[0])]).length === 1);
  // Case and +tags do not hide it.
  assert.ok(leakProblems([["upper", address(c[1]).toUpperCase()]], [address(c[1])]).length === 1);
  console.log("LEAK-1 planted: a kept signed statement and a card with the contact caught");
});
