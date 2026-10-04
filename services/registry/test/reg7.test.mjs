// REG-7 (±): on HN day, nobody fills the registry with junk, and new registrations can be paused
// without stopping anything that exists (the human's instruction, 2026-10-04).
//   - The production config (services/registry/wrangler.json) carries limits on new registrations — per
//     IP per hour, per contact per day, in all per hour — and they hold through the Worker's Durable
//     Object: past one, 429 rate_limited with Retry-After; another IP or contact still gets in; one
//     mailbox written another way (case, a +tag) is the same mailbox.
//   - The counts keep no address: nothing the Registry stores holds the IP or the email it counted.
//   - Windows end: after the hour (the day), the same IP (contact) gets in again; past the overall
//     limit, everyone waits.
//   - A Diver already registered is not new: registering it again is not counted or refused.
//   - REGISTRY_PAUSE_NEW="1" refuses new Divers and new Principals (503 registration_paused) while an
//     existing name's keys, Staples, card, bulk copy and revocation all keep working.
// The other side: the same scenarios against a Registry with no limits or an ignored pause are caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import registryWorker, { RegistryState, limitsFrom } from "../worker.mjs";
import { memoryStorage } from "../src/durable.mjs";
import { createRegistry, createMemoryStore } from "../src/index.mjs";
import { diverStore } from "./support.mjs";
import { createRegistryClient, signRootStatement } from "@ludion/diver";
import { generateRegistryKey } from "@ludion/gate-core/staple";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROD = JSON.parse(fs.readFileSync(path.join(HERE, "..", "wrangler.json"), "utf8")).vars;
const ORIGIN = "https://registry.ludion.ai";

async function worldOf(vars = {}, storage = memoryStorage()) {
  const key = await generateRegistryKey();
  const env = { REGISTRY_SIGNING_KEY: JSON.stringify(key.privateJwk), REGISTRY_ORIGIN: ORIGIN, REGISTRY_ISSUER: ORIGIN, ...vars };
  const durable = new RegistryState({ storage }, env);
  const ns = { REGISTRY: { idFromName: (n) => n, get: () => durable } };
  const fetchVia = (url, init) => registryWorker.fetch(new Request(url, init), ns);
  return { env, storage, fetchVia, durable, key };
}

/** Register a new Diver from `ip` with `contact`; the response. */
async function register(fetchVia, { ip, contact, d, nowS }) {
  d ??= await diverStore("REG-7 agent");
  d.store.signature_agent = `https://${d.store.diver_id}.agents.ludion.ai`;
  const statement = signRootStatement(d.root, "ludion-register+jwt", {
    sub: d.store.diver_id, root: { kty: "OKP", crv: "Ed25519", x: d.root.x }, signature_agent: d.store.signature_agent,
    name: d.store.name, contacts: [contact], iat: (nowS ?? Math.floor(Date.now() / 1000)) + (d.bump = (d.bump ?? 0) + 1),
  });
  const r = await fetchVia(`${ORIGIN}/v0/divers`, { method: "POST", headers: { "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) }, body: JSON.stringify({ statement }) });
  return { status: r.status, body: await r.json(), retryAfter: r.headers.get("retry-after"), d };
}

/** The production limits as numbers. */
const L = limitsFrom(PROD.REGISTRY_LIMITS);

/**
 * Run the limits scenario against a world; what is wrong with what it did.
 * @returns {Promise<string[]>}
 */
export async function limitProblems(w) {
  const out = [];
  // Per IP: perIpPerHour new names from one address get in, the next does not.
  for (let i = 0; i < L.perIpPerHour; i++) {
    const r = await register(w.fetchVia, { ip: "203.0.113.7", contact: `mailto:ip${i}@example.test` });
    if (r.status !== 201) out.push(`registration ${i + 1} from one IP: ${r.status}`);
  }
  const over = await register(w.fetchVia, { ip: "203.0.113.7", contact: "mailto:ipx@example.test" });
  if (over.status !== 429 || over.body.error !== "rate_limited" || !(Number(over.retryAfter) > 0)) out.push(`past ${L.perIpPerHour} from one IP: ${over.status} ${over.body.error} retry-after ${over.retryAfter}`);
  const other = await register(w.fetchVia, { ip: "198.51.100.9", contact: "mailto:other@example.test" });
  if (other.status !== 201) out.push(`another IP: ${other.status}`);
  // Per contact: one mailbox, written several ways, from many addresses.
  const ways = ["mailto:spam@example.test", "mailto:SPAM@Example.Test", "mailto:spam+1@example.test", "mailto:spam+hn@EXAMPLE.test"];
  for (let i = 0; i < L.perContactPerDay; i++) {
    const r = await register(w.fetchVia, { ip: `192.0.2.${10 + i}`, contact: ways[i % ways.length] });
    if (r.status !== 201) out.push(`registration ${i + 1} for one contact: ${r.status}`);
  }
  const overC = await register(w.fetchVia, { ip: "192.0.2.200", contact: ways[3] });
  if (overC.status !== 429 || overC.body.error !== "rate_limited") out.push(`past ${L.perContactPerDay} for one contact (written another way): ${overC.status}`);
  // The counts hold no address and no mailbox (a Diver's own record holds the contact it published; no IP anywhere).
  const counts = JSON.stringify([...(await w.storage.list({ prefix: "hit:" }))]);
  if (!counts.length || counts === "[]") out.push("no counts kept at all");
  for (const s of ["203.0.113.7", "198.51.100.9", "spam@example.test", "spam", "example.test"]) if (counts.includes(s)) out.push(`a count holds ${s}`);
  const all = JSON.stringify([...(await w.storage.list({ prefix: "" }))]);
  for (const s of ["203.0.113.7", "198.51.100.9", "192.0.2."]) if (all.includes(s)) out.push(`the Registry stores the address ${s}`);
  return out;
}

/** Run the pause scenario: a name registered before the pause, then the pause. */
export async function pauseProblems(vars) {
  const out = [];
  const storage = memoryStorage();
  const before = await worldOf({}, storage);
  const client = createRegistryClient({ url: ORIGIN, fetch: before.fetchVia });
  const d = await diverStore("REG-7 existing");
  d.store.signature_agent = `https://${d.store.diver_id}.agents.ludion.ai`;
  await client.register(d.store, d.root);
  // The same Durable Object storage, now with the pause on (a redeploy with the var set).
  const paused = await worldOf(vars, storage);
  paused.env.REGISTRY_SIGNING_KEY = before.env.REGISTRY_SIGNING_KEY;
  const p = new RegistryState({ storage }, paused.env);
  const ns = { REGISTRY: { idFromName: (n) => n, get: () => p } };
  const via = (url, init) => registryWorker.fetch(new Request(url, init), ns);
  const fresh = await register(via, { ip: "203.0.113.50", contact: "mailto:new@example.test" });
  if (fresh.status !== 503 || fresh.body.error !== "registration_paused" || !fresh.retryAfter) out.push(`a new Diver while paused: ${fresh.status} ${fresh.body.error}`);
  const principal = await via(`${ORIGIN}/v0/principals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential: {} }) });
  if (principal.status !== 503) out.push(`a new Principal while paused: ${principal.status}`);
  const c2 = createRegistryClient({ url: ORIGIN, fetch: via });
  try { await c2.approveKeys(d.store, d.root, [{ kty: "OKP", crv: "Ed25519", x: d.session.x }]); } catch (e) { out.push(`key approval of an existing name: ${e.message}`); }
  try { const s = await c2.staple(d.store, d.session); if (!s.staple) out.push("no Staple"); } catch (e) { out.push(`a Staple for an existing name: ${e.message}`); }
  const card = await p.fetch(new Request(`https://registry.internal/__card/${d.store.diver_id}`));
  if (card.status !== 200) out.push(`the existing name's card record: ${card.status}`);
  const bulk = await via(`${ORIGIN}/v0/bulk?since=0`);
  if (bulk.status !== 200) out.push(`the bulk copy: ${bulk.status}`);
  try { await c2.revoke(d.store, d.root, { reason: "retired" }); } catch (e) { out.push(`revoking an existing name: ${e.message}`); }
  return out;
}

test("REG-7: the production config limits new registrations, and they hold through the Durable Object without storing an address", async () => {
  assert.ok(L, `services/registry/wrangler.json has REGISTRY_LIMITS: ${JSON.stringify(PROD.REGISTRY_LIMITS)}`);
  assert.ok(L.perIpPerHour >= 3 && L.perIpPerHour <= 50, `per IP per hour ${L.perIpPerHour}`);
  assert.ok(L.perContactPerDay >= 2 && L.perContactPerDay <= 20, `per contact per day ${L.perContactPerDay}`);
  assert.ok(L.allPerHour >= 100 && L.allPerHour <= 20_000, `in all per hour ${L.allPerHour}`);
  assert.equal(PROD.REGISTRY_PAUSE_NEW, "0", "not paused by default");
  assert.deepEqual(await limitProblems(await worldOf(PROD)), []);
  console.log(`REG-7: production limits ${L.perIpPerHour}/IP/hour, ${L.perContactPerDay}/contact/day, ${L.allPerHour}/hour; 429 past each with Retry-After; no address stored`);
});

test("REG-7: windows end, the overall limit holds, and a Diver already registered is not new", async () => {
  let t = Date.parse("2026-10-13T13:00:00Z");
  const key = await generateRegistryKey();
  const store = createMemoryStore();
  const reg = await createRegistry({ key: key.privateJwk, origin: ORIGIN, store, now: () => t, limits: { perIpPerHour: 2, perContactPerDay: 50, allPerHour: 4 } });
  const via = (url, init) => reg.fetch(new Request(url, init));
  const a = await register(via, { ip: "203.0.113.1", contact: "mailto:a@example.test", nowS: Math.floor(t / 1000) });
  assert.equal(a.status, 201);
  assert.equal((await register(via, { ip: "203.0.113.1", contact: "mailto:a@example.test", d: a.d, nowS: Math.floor(t / 1000) })).status, 200, "the same Diver again: not new, not counted");
  assert.equal((await register(via, { ip: "203.0.113.1", contact: "mailto:b@example.test", nowS: Math.floor(t / 1000) })).status, 201, "the second new name from this IP");
  const third = await register(via, { ip: "203.0.113.1", contact: "mailto:c@example.test", nowS: Math.floor(t / 1000) });
  assert.equal(third.status, 429);
  assert.ok(Number(third.retryAfter) > 0 && Number(third.retryAfter) <= 3600);
  t += 3601_000;
  assert.equal((await register(via, { ip: "203.0.113.1", contact: "mailto:d@example.test", nowS: Math.floor(t / 1000) })).status, 201, "an hour later");
  // The overall limit: 4 an hour, whoever asks (this hour: one so far).
  for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) assert.equal((await register(via, { ip, contact: `mailto:${ip}@example.test`, nowS: Math.floor(t / 1000) })).status, 201, ip);
  assert.equal((await register(via, { ip: "198.51.100.4", contact: "mailto:z@example.test", nowS: Math.floor(t / 1000) })).status, 429, "past the overall limit");
  assert.equal(JSON.stringify(store.state.hits).includes("203.0.113"), false, "no address kept");
});

test("REG-7: paused, new registrations wait; every existing name keeps working", async () => {
  assert.deepEqual(await pauseProblems({ REGISTRY_PAUSE_NEW: "1" }), []);
  console.log("REG-7 pause: new Divers and Principals 503; an existing name's keys, Staple, card, bulk copy and revocation work");
});

test("REG-7: a Registry with no limits, or that ignores the pause, is caught", async () => {
  const unlimited = await limitProblems(await worldOf({}));
  assert.ok(unlimited.some((p) => /past \d+ from one IP: 201/.test(p)), unlimited.join("; "));
  assert.ok(unlimited.some((p) => /for one contact .*: 201/.test(p)), unlimited.join("; "));
  const ignored = await pauseProblems({ REGISTRY_PAUSE_NEW: "0" });
  assert.ok(ignored.some((p) => /a new Diver while paused: 201/.test(p)), ignored.join("; "));
  console.log("REG-7 planted: no limits and an ignored pause caught");
});
