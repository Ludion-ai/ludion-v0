// MND-1..4 (lane 2 spec §4): the Mandate an operator puts on its own agent (prn "self", spec §3.2),
// with a real Registry, real Divers, the real Node Gate over HTTP, and the CLI.
//   MND-1 (±): the Registry issues one only on the Diver's Root statement — a session key's statement,
//     another Diver's Root, a replay, a revoked Diver are refused — and withdraws one only on the
//     Root's word. The SDK runs with the session key alone: an agent process with no passphrase signs
//     with the Mandate the CLI's own line attaches (init, register, mandate create), and the SDK's
//     functions never touch the store's Root.
//   MND-2 (±): inside the Mandate's scope a signed request passes; outside it, 403 mandate_scope. The
//     receipt and the hourly count say ok / scope. The judge catches Gates that lost the check.
//   MND-3 (−): a Mandate for another site, expired, withdrawn, without a Staple to say whose it is, is
//     no Mandate (403 mandate_required). Another Diver's Mandate and a forged one are refused as spoofs
//     (401 invalid_signature, PRS-2; the spec asks 403 — the human's call, STATE.lane2.md).
//   MND-4 (±): per_day (checkouts a day, PRS-3) holds at a Gate with a shared record; a Gate without
//     one refuses a checkout under a Mandate with per_day. The judge catches a record that does not
//     count and a Gate that charges without one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateSiteKey, memoryLedger, MANDATE_TYP } from "@ludion/gate-core";
import { createStapleVerifier, signJws } from "@ludion/gate-core/staple";
import { generateEd25519, signRootStatement, createDiverSigner, mandateFor, mandateTerms } from "@ludion/diver";
import { registryServer, agent, site, directoryHost, testClock, ISSUER } from "./world.mjs";
import { gateCoreMutant } from "./mutant.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const CLI = path.join(ROOT, "packages/diver/bin/ludion.mjs");
const DIVER_SDK = pathToFileURL(path.join(ROOT, "packages/diver/src/index.mjs")).href;
const SHOP = "shop.example", ORIGIN = `https://${SHOP}`;
// The demo shop's routes (lane 2 spec §3.4), every one held to a scope at Pressure 2.
const ROUTES = [
  { match: "/products/**", pressure: 2, require: { scope: "read" } },
  { match: "/cart", pressure: 2, require: { scope: "checkout" } },
  { match: "/checkout", pressure: 2, require: { scope: "checkout" } },
  { match: "/account/password", pressure: 2, require: { scope: "account" } },
  { match: "/account/delete", pressure: 2, require: { scope: "delete" } },
];
const READ_CHECKOUT = { scope: ["read", "checkout"], limits: { checkout_max: 5000, currency: "JPY", per_day: 3 } };
const IN_SCOPE = [["GET", "/products"], ["GET", "/products/42"], ["POST", "/cart"], ["POST", "/checkout"]];
const OUT_OF_SCOPE = [["POST", "/account/password"], ["POST", "/account/delete"]];

const cleanups = [];
after(async () => { for (const c of cleanups.reverse()) { try { await c(); } catch { /* best effort */ } } });
const payloadOf = (jws) => JSON.parse(Buffer.from(jws.split(".")[1], "base64url").toString("utf8"));
const failure = (p) => p.then(() => null, (e) => e);
const nowS = (clock) => Math.floor(clock.now() / 1000);
/** A child process, without blocking this one (the Registry it talks to runs here). */
const run = (args, o) => new Promise((resolve) => {
  const c = execFile(process.execPath, args, { ...o, encoding: "utf8", timeout: 60_000 }, (e, stdout, stderr) => resolve({ status: e ? (e.code ?? 1) : 0, stdout, stderr }));
  c.stdin?.end();
});

let shared;
async function world() {
  if (shared) return shared;
  const clock = testClock();
  const reg = await registryServer({ now: () => clock.now() });
  cleanups.push(() => reg.close());
  const directory = directoryHost();
  const [A, B] = await Promise.all(["A", "B"].map((n) => agent({ registryUrl: reg.url, clock, directory, name: `MND ${n}` })));
  shared = { clock, reg, directory, A, B, registryKeys: reg.registry.publicKeys };
  return shared;
}

/** A Mandate the Diver's Root puts on it, for the shop unless `aud` says otherwise. */
async function selfMandate(a, terms = {}) {
  return a.client.createMandate(a.store, a.root, { aud: ORIGIN, scope: ["read"], ...terms });
}

/** The real Node Gate over HTTP, the demo shop's routes unless planted ones are given. */
async function shop(w, o = {}) {
  const s = await site({ host: SHOP, clock: w.clock, registryKeys: w.registryKeys, directory: w.directory, routes: o.routes ?? ROUTES, ...o });
  cleanups.push(() => s.close());
  return s;
}

/** send(method, path, query?) through the site over HTTP, as agent `a` carrying `mandate`. */
const viaHttp = (s, a, mandate, o = {}) => async (method, pathname, query = "") => {
  const r = await s.send(pathname + query, await a.headers(SHOP, pathname + query, { method, mandate, ...o }), method);
  return { status: r.status, error: r.error, reason: r.refusal?.reason ?? null };
};

/** A gate-core Gate (the real one, or a mutant's), driven directly. */
async function coreGate(w, mod, o = {}) {
  const gate = await mod.createGate({ siteId: "site-mnd", siteKey: (await generateSiteKey()).privateJwk, pressure: 0, now: () => w.clock.now(),
    authorities: [SHOP], routes: o.routes ?? ROUTES, registryKeys: w.registryKeys, registryIssuer: ISSUER, resolver: { fetch: w.directory.fetch }, ...o.extra });
  return gate;
}
/** send(method, path, query?) through a gate-core Gate; `?total=&currency=` charges like the shop's checkout. */
const viaCore = (gate, a, mandate, o = {}) => async (method, pathname, query = "") => {
  const h = await a.headers(SHOP, pathname + query, { method, mandate, ...o });
  const r = await gate.inspect({ kind: "request", method, targetUri: `${ORIGIN}${pathname}${query}`, fields: Object.entries(h).map(([name, value]) => ({ name, value })) });
  if (r.decision.action === "deny") return { status: r.decision.status, error: r.decision.error, reason: null, receipt: r.receipt };
  const q = new URLSearchParams(query.replace(/^\?/, ""));
  if (q.has("total")) {
    const c = await gate.charge(r, { amount: Number(q.get("total")), currency: q.get("currency") });
    if (!c.ok) return { status: c.status, error: c.error, reason: c.reason, receipt: r.receipt };
  }
  return { status: 200, error: null, reason: null, receipt: r.receipt };
};

// ── judges ──────────────────────────────────────────────────────────────────────────────────────

/** MND-2: what is wrong with how a Gate holds a read+checkout Mandate to its scope. */
async function scopeProblems(send) {
  const out = [];
  for (const [m, p] of IN_SCOPE) { const r = await send(m, p); if (r.status !== 200) out.push(`${m} ${p} is in scope, got ${r.status} ${r.error ?? ""}`); }
  for (const [m, p] of OUT_OF_SCOPE) { const r = await send(m, p); if (r.status !== 403 || r.error !== "mandate_scope") out.push(`${m} ${p} is outside the scope, got ${r.status} ${r.error ?? ""}`); }
  return out;
}

/** MND-3: what is wrong with how a Gate treats Mandates that do not hold (each `cases` entry: [what, send]). */
async function invalidProblems(cases) {
  const out = [];
  for (const [what, send] of cases) {
    const r = await send("GET", "/products");
    if (r.status !== 403 || r.error !== "mandate_required") out.push(`${what}: got ${r.status} ${r.error ?? ""}, not 403 mandate_required`);
  }
  return out;
}

/** MND-4: per_day 3 at a Gate with a record (`counted`) and one without (`uncounted`). */
async function perDayProblems({ counted, uncounted }) {
  const out = [];
  const buy = (send) => send("POST", "/checkout", "?total=1000&currency=JPY");
  if (counted) {
    const seq = [];
    for (let i = 0; i < 4; i++) seq.push(await buy(counted));
    seq.slice(0, 3).forEach((r, i) => { if (r.status !== 200) out.push(`checkout ${i + 1} of per_day 3 refused: ${r.status} ${r.error ?? ""} ${r.reason ?? ""}`); });
    if (seq[3].status !== 403 || seq[3].error !== "mandate_scope" || seq[3].reason !== "per_day") out.push(`checkout 4 of per_day 3: ${seq[3].status} ${seq[3].error ?? ""} ${seq[3].reason ?? ""}`);
  }
  if (uncounted) {
    const r = await buy(uncounted);
    if (r.status !== 403 || r.error !== "mandate_scope" || r.reason !== "no_shared_ledger") out.push(`a Gate with no record let a per_day checkout through: ${r.status} ${r.error ?? ""} ${r.reason ?? ""}`);
  }
  return out;
}

// ── MND-1 ───────────────────────────────────────────────────────────────────────────────────────

test("MND-1: the Registry issues a Mandate on the Diver's Root statement only — not a session key's, another Diver's Root, a replay or a revoked Diver's", async () => {
  const w = await world();
  const before = Object.keys(w.reg.registry.store.state.mandates).length;
  const ok = await selfMandate(w.A, READ_CHECKOUT);
  const p = payloadOf(ok.mandate);
  assert.equal(p.prn, "self");
  assert.deepEqual({ iss: p.iss, sub: p.sub, aud: p.aud, scope: p.scope, limits: p.limits }, { iss: ISSUER, sub: w.A.store.diver_id, aud: ORIGIN, ...READ_CHECKOUT });
  assert.equal(p.exp - p.iat, 86_400, "24 h by default");
  const v = await createStapleVerifier(w.registryKeys, { issuer: ISSUER, now: () => w.clock.now() });
  assert.equal((await v.verifyStatement(ok.mandate, { typ: MANDATE_TYP })).jti, ok.jti, "signed by the Registry");

  const refused = [];
  const post = async (id, statement) => { const r = await fetch(`${w.reg.url}/v0/divers/${id}/mandates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statement }) }); return { status: r.status, ...(await r.json()) }; };
  const terms = (sub) => ({ sub, aud: ORIGIN, scope: ["read", "account", "delete"], iat: nowS(w.clock), nonce: `n-${Math.random().toString(36).slice(2, 14)}` });
  const s1 = await failure(w.A.client.createMandate(w.A.store, w.A.session, { aud: ORIGIN, scope: ["delete"] }));
  refused.push(["the session key, through the SDK's own client", s1?.status, 401]);
  refused.push(["the session key, by hand", (await post(w.A.store.diver_id, signRootStatement(w.A.session, "ludion-mandate-self+jwt", terms(w.A.store.diver_id)))).status, 401]);
  refused.push(["another Diver's Root for A", (await post(w.A.store.diver_id, signRootStatement(w.B.root, "ludion-mandate-self+jwt", terms(w.A.store.diver_id)))).status, 401]);
  refused.push(["a fresh key that is no Root", (await post(w.A.store.diver_id, signRootStatement((await generateEd25519()).privateJwk, "ludion-mandate-self+jwt", terms(w.A.store.diver_id)))).status, 401]);
  refused.push(["A's Root, another typ (a key approval)", (await post(w.A.store.diver_id, signRootStatement(w.A.root, "ludion-keys+jwt", terms(w.A.store.diver_id)))).status, 401]);
  refused.push(["A's Root, naming B", (await post(w.A.store.diver_id, signRootStatement(w.A.root, "ludion-mandate-self+jwt", terms(w.B.store.diver_id)))).status, 400]);
  refused.push(["a stale statement", (await post(w.A.store.diver_id, signRootStatement(w.A.root, "ludion-mandate-self+jwt", { ...terms(w.A.store.diver_id), iat: nowS(w.clock) - 3600 }))).status, 400]);
  const once = signRootStatement(w.A.root, "ludion-mandate-self+jwt", terms(w.A.store.diver_id));
  assert.equal((await post(w.A.store.diver_id, once)).status, 201, "the Root's statement, once");
  refused.push(["the same statement again (a replay)", (await post(w.A.store.diver_id, once)).status, 409]);
  // A request signed like a Staple request (RFC 9421, session key) carries no Root statement.
  const signer = await createDiverSigner({ sessionPrivateJwk: w.A.session, signatureAgent: w.A.store.signature_agent, now: () => w.clock.now(), insecureAllowHttp: true });
  const url = `${w.reg.url}/v0/divers/${w.A.store.diver_id}/mandates`, body = JSON.stringify({ aud: ORIGIN, scope: ["delete"] });
  const signed = await fetch(url, { method: "POST", headers: await signer.headersFor({ method: "POST", url, headers: { "content-type": "application/json" }, body }), body });
  refused.push(["an RFC 9421 request signed by the session key", signed.status, 400]);
  const C = await agent({ registryUrl: w.reg.url, clock: w.clock, directory: w.directory, name: "MND C" });
  await C.client.revoke(C.store, C.root);
  refused.push(["a revoked Diver's Root", (await failure(selfMandate(C)))?.status, 403]);

  assert.deepEqual(refused.filter(([, got, want]) => got !== want).map(([what, got, want]) => `${what}: ${got}, want ${want}`), []);
  assert.equal(Object.keys(w.reg.registry.store.state.mandates).length - before, 2, "only the two Root statements issued anything");
  console.log(`MND-1: issued on the Root's statement; ${refused.length} other requests refused, none issued`);
});

test("MND-1: only the Root withdraws a Mandate it put on its Diver; the stream carries the jti", async () => {
  const w = await world();
  const m = await selfMandate(w.A);
  const post = async (id, statement) => (await fetch(`${w.reg.url}/v0/divers/${id}/mandates/${m.jti}/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statement }) })).status;
  const st = (key, sub) => signRootStatement(key, "ludion-mandate-self-revoke+jwt", { sub, jti: m.jti, iat: nowS(w.clock) });
  assert.equal(await post(w.A.store.diver_id, st(w.A.session, w.A.store.diver_id)), 401, "A's session key");
  assert.equal(await post(w.A.store.diver_id, st(w.B.root, w.A.store.diver_id)), 401, "B's Root on A's path");
  assert.equal(await post(w.B.store.diver_id, st(w.B.root, w.B.store.diver_id)), 403, "B's Root on its own path: not B's Mandate");
  const r = await w.A.client.revokeMandate(w.A.store, w.A.root, m.jti);
  const list = await (await fetch(`${w.reg.url}/v0/revocations?since=${r.seq - 1}`)).json();
  const entry = payloadOf(list.entries.at(-1));
  assert.deepEqual({ scope: entry.scope, mdt: entry.mdt, sub: entry.sub }, { scope: "mandate", mdt: [m.jti], sub: w.A.store.diver_id });
  assert.ok((await w.A.refresh()) && payloadOf(w.A.staple.staple).mrev?.includes(m.jti), "the next Staple carries it (mrev)");
});

test("MND-1: the SDK runs with the session key alone — mandateFor and the signer never read the Root", async () => {
  const w = await world();
  const m = await selfMandate(w.A, READ_CHECKOUT);
  const other = await selfMandate(w.A, { aud: "https://other.example" });
  const t = nowS(w.clock);
  const touched = [];
  const store = new Proxy({ ...w.A.store, root: { sealed: "…" }, mandates: [
    { jti: other.jti, aud: "https://other.example", scope: ["read"], iat: t, exp: other.exp, mandate: other.mandate },
    { jti: m.jti, aud: ORIGIN, ...READ_CHECKOUT, iat: t, exp: m.exp, mandate: m.mandate },
  ] }, { get(target, k) { if (k === "root") touched.push("root"); return Reflect.get(target, k); } });
  const signer = await createDiverSigner({ sessionPrivateJwk: store.session, signatureAgent: store.signature_agent, now: () => w.clock.now(),
    staple: () => w.A.staple.staple, mandate: mandateFor(store, { now: () => w.clock.now() }) });
  const h = await signer.headersFor({ method: "GET", url: `${ORIGIN}/products` });
  assert.equal(payloadOf(h["ludion-mandate"]).jti, m.jti, "the shop's Mandate for the shop");
  assert.match(h["signature-input"], /"ludion-mandate"/, "covered by the signature");
  assert.equal(payloadOf((await signer.headersFor({ method: "GET", url: "https://other.example/" }))["ludion-mandate"]).jti, other.jti, "another site's for that site");
  assert.equal((await signer.headersFor({ method: "GET", url: "https://third.example/" }))["ludion-mandate"], undefined, "none where it has none");
  const s = await shop(w);
  const r = await s.send("/products", h);
  assert.equal(r.status, 200);
  assert.equal(r.body.mandate, m.jti);
  assert.deepEqual(touched, [], "the store's Root was never read");
});

test("MND-1: the CLI's own flow — init, register, mandate create — then an agent with no passphrase signs with the line it printed", async () => {
  const w = await world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-mnd1-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { LUDION_ROOT_PASSPHRASE: _p, LUDION_DEV: _d, ...base } = process.env;
  const operator = { ...base, LUDION_ROOT_PASSPHRASE: "correct horse battery staple, sealed" };
  const cli = async (args, env = operator) => {
    const r = await run([CLI, ...args], { cwd: dir, env });
    assert.equal(r.status, 0, `ludion ${args.join(" ")}: ${r.stdout}${r.stderr}`);
    return r.stdout;
  };
  await cli(["init", "--name", "MND-1 CLI agent", "--contact", "mailto:ops@example.test", "--no-question"]);
  await cli(["register", "--registry", w.reg.url]);
  const out = await cli(["mandate", "create", "--site", ORIGIN, "--scope", "read,checkout", "--checkout-max", "5000", "--currency", "JPY", "--per-day", "3", "--expires", "24h"]);
  const jti = /Mandate (mdt-[A-Za-z0-9_-]+)/.exec(out)?.[1];
  const line = /Attach it: (createDiverSigner\(.+\))\s*$/m.exec(out)?.[1];
  assert.ok(jti && line, out);
  assert.match(await cli(["mandate", "list"]), new RegExp(`${jti}  ${ORIGIN} — read, checkout; checkout up to 5000 JPY, 3 a day`));
  const me = JSON.parse(fs.readFileSync(path.join(dir, "ludion.json"), "utf8"));
  assert.ok(me.root?.sealed, "the Root is sealed in ludion.json");
  w.directory.publish(me);

  // The agent: the printed line, verbatim, in a process with no passphrase. It must not need the Root.
  fs.writeFileSync(path.join(dir, "agent.mjs"), [
    'import fs from "node:fs";',
    `import { createDiverSigner, mandateFor } from ${JSON.stringify(DIVER_SDK)};`,
    'const me = JSON.parse(fs.readFileSync("ludion.json", "utf8"));',
    `const signer = await ${line};`,
    `console.log(JSON.stringify(await signer.headersFor({ method: "GET", url: ${JSON.stringify(`${ORIGIN}/products`)} })));`,
  ].join("\n"));
  const ran = await run(["agent.mjs"], { cwd: dir, env: base });
  assert.equal(ran.status, 0, ran.stderr);
  const h = JSON.parse(ran.stdout.trim().split("\n").at(-1));
  assert.equal(payloadOf(h["ludion-mandate"]).jti, jti);
  const r = await (await shop(w)).send("/products", h);
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.body.class, "VERIFIED");
  assert.equal(r.body.mandate, jti);

  // And the same agent cannot make itself a wider one: the CLI without the passphrase stops.
  const wider = await run([CLI, "mandate", "create", "--site", ORIGIN, "--scope", "read,account,delete"], { cwd: dir, env: base });
  assert.notEqual(wider.status, 0);
  assert.match(wider.stderr, /needs the Root/);
  console.log(`MND-1: CLI → ${jti}; an agent with no passphrase VERIFIED with it`);
});

test("MND-1: mandate create's flags — limits go with checkout; 7 days at most; an https origin", () => {
  const ok = mandateTerms({ site: ORIGIN, scope: "read,checkout", checkoutMax: "5000", currency: "jpy", perDay: "3", expires: "24h", now: 0 });
  assert.deepEqual(ok, { aud: ORIGIN, scope: ["read", "checkout"], limits: { checkout_max: 5000, currency: "JPY", per_day: 3 }, exp: 86_400 });
  for (const [f, why] of [
    [{ site: ORIGIN, scope: "read,checkout", perDay: "3" }, "per_day with no per-checkout limit"],
    [{ site: ORIGIN, scope: "checkout" }, "checkout with no limits"],
    [{ site: ORIGIN, scope: "read", checkoutMax: "5000", currency: "JPY" }, "limits with no checkout"],
    [{ site: ORIGIN, scope: "read", expires: "8d" }, "more than 7 days"],
    [{ site: "http://shop.example", scope: "read" }, "not https"],
    [{ site: `${ORIGIN}/cart`, scope: "read" }, "a path"],
    [{ site: ORIGIN, scope: "read,shop" }, "a word not in the vocabulary"],
    [{ site: ORIGIN, scope: "read,read" }, "a word twice"],
  ]) assert.throws(() => mandateTerms(f), /--/, why);
});

// ── MND-2 ───────────────────────────────────────────────────────────────────────────────────────

test("MND-2: inside its Mandate's scope a signed request passes; outside it the real Node Gate answers 403 mandate_scope", async () => {
  const w = await world();
  const m = await selfMandate(w.A, READ_CHECKOUT);
  assert.deepEqual(await scopeProblems(viaHttp(await shop(w, { mandateLedger: memoryLedger() }), w.A, m.mandate)), []);
  // No Mandate at all: the scoped routes ask for one.
  const none = await viaHttp(await shop(w), w.A, undefined)("GET", "/products");
  assert.deepEqual([none.status, none.error], [403, "mandate_required"]);
  console.log(`MND-2: ${IN_SCOPE.length} in scope passed, ${OUT_OF_SCOPE.length} outside refused (mandate_scope)`);
});

test("MND-2: the receipt and the hourly count carry the Mandate's part (ok, scope), never the Mandate", async () => {
  const w = await world();
  const m = await selfMandate(w.A, READ_CHECKOUT);
  const batches = [];
  const real = await import("@ludion/gate-core");
  const gate = await coreGate(w, real, { extra: { sink: (b) => batches.push(b), sendMetadata: true } });
  const send = viaCore(gate, w.A, m.mandate);
  assert.equal((await send("GET", "/products")).receipt.mandate, "ok");
  assert.equal((await send("POST", "/account/delete")).receipt.mandate, "scope");
  assert.equal((await viaCore(gate, w.A, undefined)("GET", "/products")).receipt.mandate, "required");
  gate.flush({ all: true });
  const rows = batches.flatMap((b) => b.rows);
  assert.deepEqual(rows.map((r) => r.mandate).sort(), ["ok", "required", "scope"]);
  assert.ok(!JSON.stringify(batches).includes(m.jti) && !JSON.stringify(batches).includes(m.mandate), "the Mandate itself stays on the site");
});

test("MND-2: the judge bites — a Gate whose scope check is gone, a route that names no scope, Pressure 1", async () => {
  const w = await world();
  const m = await selfMandate(w.A, READ_CHECKOUT);
  const real = await import("@ludion/gate-core");
  assert.deepEqual(await scopeProblems(viaCore(await coreGate(w, real), w.A, m.mandate)), [], "control: the real gate-core, driven directly");
  // A route that names two scopes (read and account) is where "only the first one" shows.
  const two = ROUTES.map((r) => (r.match === "/account/password" ? { ...r, require: { scope: ["read", "account"] } } : r));
  assert.deepEqual(await scopeProblems(viaCore(await coreGate(w, real, { routes: two }), w.A, m.mandate)), [], "control: two scopes on one route");
  const planted = [];
  for (const [what, from, to, routes] of [
    ["decide() without the mandate_scope answer", 'if (verdict === "scope") return { action: "deny", status: 403, error: "mandate_scope" };', ""],
    ["a verdict that never says scope", 'return [].concat(require.scope).every((s) => m.scope?.includes(s)) ? "ok" : "scope";', 'return "ok";'],
    ["only the first scope a route names", "[].concat(require.scope).every(", "[].concat(require.scope).slice(0, 1).every(", two],
  ]) {
    const mut = await gateCoreMutant("classify.mjs", from, to);
    cleanups.push(mut.cleanup);
    planted.push([what, await scopeProblems(viaCore(await coreGate(w, mut.mod, { routes }), w.A, m.mandate))]);
  }
  const unscoped = ROUTES.map((r) => (r.match.startsWith("/account") ? { match: r.match, pressure: 2 } : r));
  planted.push(["/account/* with no scope", await scopeProblems(viaHttp(await shop(w, { routes: unscoped }), w.A, m.mandate))]);
  planted.push(["Pressure 1", await scopeProblems(viaHttp(await shop(w, { routes: ROUTES.map((r) => ({ ...r, pressure: 1 })) }), w.A, m.mandate))]);
  planted.push(["/account/delete asks for read", await scopeProblems(viaHttp(await shop(w, { routes: ROUTES.map((r) => (r.match === "/account/delete" ? { ...r, require: { scope: "read" } } : r)) }), w.A, m.mandate))]);
  assert.deepEqual(planted.filter(([, p]) => !p.length).map(([what]) => what), [], "every planted Gate is caught");
  console.log(`MND-2: ${planted.length} planted Gates caught (${planted.map(([w]) => w).join("; ")})`);
});

// ── MND-3 ───────────────────────────────────────────────────────────────────────────────────────

test("MND-3: a Mandate for another site, expired, withdrawn (subscribed or not), or with no Staple is no Mandate — 403 mandate_required", async () => {
  const w = await world();
  const subscribed = await shop(w, { revocations: { url: `${w.reg.url}/v0/revocations/stream`, retryMs: 200, maxRetryMs: 1000 } });
  const plain = await shop(w);
  const good = await selfMandate(w.A);
  assert.equal((await viaHttp(plain, w.A, good.mandate)("GET", "/products")).status, 200, "control");
  const elsewhere = await selfMandate(w.A, { aud: "https://other.example" });
  const short = await selfMandate(w.A, { exp: nowS(w.clock) + 120 });
  const withdrawn = await selfMandate(w.A);
  await w.A.client.revokeMandate(w.A.store, w.A.root, withdrawn.jti);
  const deadline = Date.now() + 5000;
  while (!subscribed.gate.revocations?.match({ mandate: withdrawn.jti }) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  const cases = [
    ["a Mandate for another site", viaHttp(plain, w.A, elsewhere.mandate)],
    ["no Staple to say whose it is", viaHttp(plain, w.A, good.mandate, { withStaple: false })],
    ["withdrawn, at a Gate that subscribes (seconds)", viaHttp(subscribed, w.A, withdrawn.mandate)],
  ];
  const before = await invalidProblems(cases);
  await w.A.refresh(); // the next Staple carries the withdrawal (mrev) to every other Gate
  const afterRefresh = await invalidProblems([["withdrawn, at a Gate that does not subscribe (the next Staple)", viaHttp(plain, w.A, withdrawn.mandate)]]);
  w.clock.advanceTo(w.clock.now() + 200_000); // past the short Mandate's exp (the Staple still lives)
  const expired = await invalidProblems([["expired", viaHttp(plain, w.A, short.mandate)]]);
  w.clock.reset(); await w.A.refresh();
  assert.deepEqual([...before, ...afterRefresh, ...expired], []);
  console.log(`MND-3: ${cases.length + 2} Mandates that do not hold → 403 mandate_required`);
});

test("MND-3: another Diver's Mandate and a forged one are refused as spoofs (PRS-2), never let through", async () => {
  const w = await world();
  const plain = await shop(w);
  const as = await selfMandate(w.A);
  const forger = await generateEd25519();
  const forged = await signJws((await crypto.subtle.importKey("jwk", forger.privateJwk, { name: "Ed25519" }, false, ["sign"])), "forged", MANDATE_TYP,
    { ...payloadOf(as.mandate), scope: ["read", "account", "delete"] });
  for (const [what, send] of [["B carrying A's Mandate", viaHttp(plain, w.B, as.mandate)], ["a Mandate the Registry did not sign", viaHttp(plain, w.A, forged)]]) {
    const r = await send("POST", "/account/delete");
    assert.equal(r.status, 401, `${what}: ${r.status} ${r.error}`);
    assert.equal(r.error, "invalid_signature", what);
  }
});

test("MND-3: the judge bites — Gates that ignore the site, the expiry or the withdrawal", async () => {
  const w = await world();
  const elsewhere = await selfMandate(w.A, { aud: "https://other.example" });
  const short = await selfMandate(w.A, { exp: nowS(w.clock) + 120 });
  const withdrawn = await selfMandate(w.A);
  await w.A.client.revokeMandate(w.A.store, w.A.root, withdrawn.jti);
  await w.A.refresh();
  const caught = [];
  for (const [what, from, mandate, later] of [
    ["the site", 'if (!here) throw new MandateError("mandate is for another site", "audience");', elsewhere.mandate],
    ["the expiry", 'if (p.exp < t - skew) throw new MandateError("mandate expired", "expired");', short.mandate, 200_000],
    ["the withdrawal", 'if (revoked) throw new MandateError("mandate revoked by its Principal", "revoked");', withdrawn.mandate],
  ]) {
    const real = await import("@ludion/gate-core");
    if (later) w.clock.advanceTo(Date.now() + later);
    const control = await invalidProblems([[what, viaCore(await coreGate(w, real), w.A, mandate)]]);
    const mut = await gateCoreMutant("mandate.mjs", from, "");
    cleanups.push(mut.cleanup);
    const planted = await invalidProblems([[what, viaCore(await coreGate(w, mut.mod), w.A, mandate)]]);
    w.clock.reset();
    assert.deepEqual(control, [], `control (${what})`);
    caught.push([what, planted.length > 0]);
  }
  assert.deepEqual(caught.filter(([, c]) => !c).map(([w]) => w), [], "a Gate that ignores it is caught");
});

// ── MND-4 ───────────────────────────────────────────────────────────────────────────────────────

test("MND-4: per_day holds at a Gate with a shared record; a Gate with none refuses a Mandate with per_day; per-checkout limits hold at either", async () => {
  const w = await world();
  const counted = await shop(w, { mandateLedger: memoryLedger() });
  const uncounted = await shop(w);
  const m = await selfMandate(w.A, READ_CHECKOUT);
  assert.deepEqual(await perDayProblems({ counted: viaHttp(counted, w.A, m.mandate), uncounted: viaHttp(uncounted, w.A, m.mandate) }), []);
  // Without per_day there is nothing to count: the same checkout passes where nothing counts.
  const plain = await selfMandate(w.A, { scope: ["read", "checkout"], limits: { checkout_max: 5000, currency: "JPY" } });
  assert.equal((await viaHttp(uncounted, w.A, plain.mandate)("POST", "/checkout", "?total=1000&currency=JPY")).status, 200);
  for (const [s, what] of [[counted, "with a record"], [uncounted, "without one"]]) {
    const r = await viaHttp(s, w.A, plain.mandate)("POST", "/checkout", "?total=5001&currency=JPY");
    assert.deepEqual([r.status, r.error, r.reason], [403, "mandate_scope", "over_limit"], what);
  }
  console.log("MND-4: 3 of per_day 3 passed, the 4th refused (per_day); no record → refused (no_shared_ledger)");
});

test("MND-4: the judge bites — a record that does not count, a Gate that charges without a record", async () => {
  const w = await world();
  const m = await selfMandate(w.A, READ_CHECKOUT);
  const real = await import("@ludion/gate-core");
  const counted = (mod, ledger) => coreGate(w, mod, { extra: { mandateLedger: ledger } });
  assert.deepEqual(await perDayProblems({ counted: viaCore(await counted(real, real.memoryLedger()), w.A, m.mandate), uncounted: viaCore(await coreGate(w, real), w.A, m.mandate) }), [], "control");
  const lax = { shared: true, charge: async () => ({ ok: true, count: 1 }) };
  const mut = await gateCoreMutant("index.mjs", 'if (!ledger) return refuse("mandate_scope", "no_shared_ledger");', "if (!ledger) return { ok: true, enforced: true, remaining: { per_day: null } };");
  cleanups.push(mut.cleanup);
  const planted = [
    ["a record that does not count", await perDayProblems({ counted: viaCore(await counted(real, lax), w.A, (await selfMandate(w.A, READ_CHECKOUT)).mandate) })],
    ["a Gate that charges without a record", await perDayProblems({ uncounted: viaCore(await coreGate(w, mut.mod), w.A, m.mandate) })],
  ];
  assert.deepEqual(planted.filter(([, p]) => !p.length).map(([what]) => what), []);
});
