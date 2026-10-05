// REG-5 (±): the Registry's whole copy for large verifiers (spec §14.3, ADR-033) is signed and
// versioned, and handing it out leaves no trace of who asked.
//   + GET /v0/bulk is one JWS the Registry signs: every Diver's public record, revoked ones flagged.
//     A delta (?since=V) applied to the copy at V is the copy now. A changed byte fails the signature.
//     Each record is what the Card Host serves for that Diver: one public record, two ways out.
//   − Serving it writes nothing and logs nothing: the store is the same before and after, byte for
//     byte, with canaries in every header, the query and the address; through the production Worker
//     too. The judge is tried on a planted Registry that remembers who asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, createMemoryStore, BULK_TYP } from "../src/index.mjs";
import { createDurableStore, memoryStorage } from "../src/durable.mjs";
import registryWorker, { RegistryState, CARD_PREFIX } from "../worker.mjs";
import { createRegistryClient } from "@ludion/diver";
import { generateRegistryKey, createStapleVerifier } from "@ludion/gate-core/staple";
import { diverStore } from "./support.mjs";

const ORIGIN = "https://registry.ludion.ai";
const CANARIES = ["ua-canary-r5", "203.0.113.55", "cookie-canary-r5", "ref-canary-r5", "who-canary-r5"];

async function world(kind = "memory") {
  const key = await generateRegistryKey();
  const storage = memoryStorage();
  const store = kind === "durable" ? await createDurableStore(storage) : createMemoryStore();
  const registry = await createRegistry({ key: key.privateJwk, origin: ORIGIN, store });
  const fetch = (url, init) => registry.fetch(new Request(url, init));
  const client = createRegistryClient({ url: ORIGIN, fetch });
  const verifier = await createStapleVerifier({ keys: [key.publicJwk] }, { issuer: ORIGIN });
  const dump = async () => (kind === "durable" ? JSON.stringify([...(await storage.list({ prefix: "" }))]) : JSON.stringify(store.state));
  return { key, store, storage, registry, fetch, client, verifier, dump };
}

async function diver(w, name) {
  const d = await diverStore(name);
  await w.client.register(d.store, d.root);
  await w.client.approveKeys(d.store, d.root, [{ kty: "OKP", crv: "Ed25519", x: d.session.x }]);
  return d;
}

/** The copy as a verifier keeps it: diver_id → record, after checking the Registry's signature. */
async function take(w, since = 0) {
  const r = await w.fetch(`${ORIGIN}/v0/bulk?since=${since}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  const p = await w.verifier.verifyStatement(body.jws, { typ: BULK_TYP, maxBytes: 64 << 20 });
  assert.equal(p.version, body.version);
  assert.equal(p.since, since);
  return p;
}
const apply = (copy, delta) => {
  const out = new Map(copy);
  for (const d of delta.divers) out.set(d.diver_id, d);
  return out;
};
const asMap = (p) => new Map(p.divers.map((d) => [d.diver_id, d]));

for (const kind of ["memory", "durable"]) {
  test(`REG-5: the whole copy is signed and versioned; a delta on the copy at V is the copy now (${kind} store)`, async () => {
    const w = await world(kind);
    const a = await diver(w, "Agent A"), b = await diver(w, "Agent B");
    const first = await take(w);
    assert.deepEqual([...asMap(first).keys()].sort(), [a.store.diver_id, b.store.diver_id].sort());
    assert.ok(first.divers.every((d) => d.keys.length === 1 && d.keys.every((k) => !("d" in k)) && d.revoked === false), "public members only");
    const c = await diver(w, "Agent C");
    await w.client.approveKeys(a.store, a.root, [{ kty: "OKP", crv: "Ed25519", x: a.session.x }, { kty: "OKP", crv: "Ed25519", x: c.session.x }]);
    await w.client.revoke(b.store, b.root, { reason: "retired" });
    const delta = await take(w, first.version);
    assert.deepEqual(delta.divers.map((d) => d.diver_id).sort(), [a.store.diver_id, b.store.diver_id, c.store.diver_id].sort(), "the delta holds what changed");
    const now = await take(w);
    assert.ok(now.version > first.version);
    assert.deepEqual(apply(asMap(first), delta), asMap(now), "the copy at V plus the delta is the copy now");
    assert.equal(asMap(now).get(b.store.diver_id).revoked, true, "a revoked Diver stays in the copy, flagged, so copies drop it");
    assert.equal((await take(w, now.version)).divers.length, 0, "nothing changed since now");
    // One public record, two ways out: the bulk copy and the Card Host's question.
    const durable = new RegistryState({ storage: memoryStorage() }, {});
    durable.ready = async () => { durable.store = w.store; durable.registry = w.registry; };
    const card = await (await durable.fetch(new Request(`https://registry.internal${CARD_PREFIX}${a.store.diver_id}`))).json();
    const { revoked, ver, ...fromBulk } = asMap(now).get(a.store.diver_id);
    assert.deepEqual(fromBulk, card);
    // A changed byte fails, and a malformed version is refused.
    const body = await (await w.fetch(`${ORIGIN}/v0/bulk`)).json();
    const [h, p, s] = body.jws.split(".");
    const forged = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    forged.divers[0].keys[0].x = "A".repeat(43);
    await assert.rejects(w.verifier.verifyStatement(`${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${s}`, { typ: BULK_TYP, maxBytes: 64 << 20 }));
    for (const v of ["-1", "1.5", "x", "1e3"]) assert.equal((await w.fetch(`${ORIGIN}/v0/bulk?since=${v}`)).status, 400, v);
    if (kind === "memory") console.log(`REG-5: ${now.divers.length} Divers in a signed copy (version ${now.version}); the delta since ${first.version} rebuilt it exactly; a forged key failed the signature`);
  });
}

test("REG-5: the copy is listed once per version and signed once a minute per (version, since), never stale past a change", async () => {
  const key = await generateRegistryKey();
  const store = createMemoryStore();
  let lists = 0;
  const listDivers = store.listDivers.bind(store);
  store.listDivers = async () => { lists++; return listDivers(); };
  let t = Date.now();
  const registry = await createRegistry({ key: key.privateJwk, origin: ORIGIN, store, now: () => t });
  const w = { fetch: (url, init) => registry.fetch(new Request(url, init)), verifier: await createStapleVerifier({ keys: [key.publicJwk] }, { issuer: ORIGIN, now: () => t }) };
  w.client = createRegistryClient({ url: ORIGIN, fetch: w.fetch });
  const a = await diver(w, "Bulk A");
  lists = 0;
  // 40 asks of the whole copy and of deltas, unchanged: one listing; the whole copy signed once.
  const jwss = new Set();
  for (let i = 0; i < 40; i++) {
    const body = await (await w.fetch(`${ORIGIN}/v0/bulk?since=${i % 2 ? 1 : 0}`)).json();
    if (body.since === 0) jwss.add(body.jws);
  }
  assert.equal(lists, 1, `listed ${lists} times for 40 asks of an unchanged copy`);
  assert.equal(jwss.size, 1, "the whole copy is signed once a minute");
  // A change is in the next copy at once.
  const b = await diver(w, "Bulk B");
  const now = await take(w);
  assert.deepEqual(now.divers.map((d) => d.diver_id).sort(), [a.store.diver_id, b.store.diver_id].sort(), "a new Diver is in the next copy");
  // A minute on, the same copy is signed afresh.
  t += 61_000;
  const later = await (await w.fetch(`${ORIGIN}/v0/bulk?since=0`)).json();
  assert.ok(!jwss.has(later.jws) && (await take(w)).iat === Math.floor(t / 1000), "signed again after a minute");
  // Many different deltas keep a bounded set of signed copies, each still correct.
  for (let s = 0; s < 40; s++) assert.equal((await take(w, s)).since, s);
  console.log(`REG-5: 40 asks of an unchanged copy listed the Registry once; a change showed at once; a minute on it was signed again`);
});

/** What a request left behind: the store changed, a canary kept, a log line. */
export function traceProblems({ before, after, logged }) {
  const out = [];
  if (before !== after) out.push("the store changed");
  for (const c of CANARIES) if (after.includes(c)) out.push(`the store keeps ${c}`);
  if (logged.length) out.push(`${logged.length} log line(s)`);
  return out;
}

async function asked(w, fetchVia) {
  const logged = [], saved = {};
  for (const m of ["log", "info", "warn", "error", "debug"]) { saved[m] = console[m]; console[m] = (...a) => logged.push(a.map(String).join(" ")); }
  try {
    const before = await w.dump();
    for (const since of [0, 1]) {
      const r = await fetchVia(new Request(`${ORIGIN}/v0/bulk?since=${since}&who=who-canary-r5`, { headers: {
        "user-agent": "ua-canary-r5", "cf-connecting-ip": "203.0.113.55", "x-forwarded-for": "203.0.113.55", cookie: "s=cookie-canary-r5", referer: "https://ref-canary-r5.example/" } }));
      assert.equal(r.status, 200);
    }
    return { before, after: await w.dump(), logged };
  } finally { Object.assign(console, saved); }
}

test("REG-5: the judge catches a Registry that remembers who asked for the copy (planted)", async () => {
  const w = await world("durable");
  await diver(w, "Agent A");
  const planted = async (request) => {
    await w.storage.put(`asked:${request.headers.get("cf-connecting-ip")}`, { ua: request.headers.get("user-agent"), at: Date.now() });
    return w.registry.fetch(request);
  };
  assert.ok(traceProblems(await asked(w, planted)).some((p) => /store/.test(p)));
  const chatty = async (request) => { console.info(`bulk for ${request.headers.get("cf-connecting-ip")}`); return w.registry.fetch(request); };
  assert.ok(traceProblems(await asked(w, chatty)).some((p) => /log line/.test(p)));
});

test("REG-5: handing out the copy leaves no trace — the store byte for byte the same, nothing logged, directly and through the Worker", async () => {
  for (const kind of ["memory", "durable"]) {
    const w = await world(kind);
    await diver(w, "Agent A"); await diver(w, "Agent B");
    assert.deepEqual(traceProblems(await asked(w, (r) => w.registry.fetch(r))), [], kind);
  }
  // The production path: the Worker in front of the Durable Object.
  const key = await generateRegistryKey();
  const storage = memoryStorage();
  const state = new RegistryState({ storage }, { REGISTRY_SIGNING_KEY: JSON.stringify(key.privateJwk), REGISTRY_ORIGIN: ORIGIN, REGISTRY_ISSUER: ORIGIN });
  const env = { REGISTRY: { idFromName: (n) => n, get: () => state } };
  const client = createRegistryClient({ url: ORIGIN, fetch: (url, init) => registryWorker.fetch(new Request(url, init), env) });
  const d = await diverStore("Worker agent");
  await client.register(d.store, d.root);
  const w = { dump: async () => JSON.stringify([...(await storage.list({ prefix: "" }))]) };
  assert.deepEqual(traceProblems(await asked(w, (r) => registryWorker.fetch(r, env))), [], "through the Worker");
  console.log("REG-5: two requests for the copy, canaries in every header, the query and the address, left the store unchanged and logged nothing (memory, Durable Object, the Worker)");
});
