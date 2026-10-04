// STD-3 (docs/MISSION.md §4): interop both ways with ≥2 independent implementations.
//
//   ours  — @ludion/diver signs, @ludion/gate-core verifies (VERIFIED with the right identifier)
//   cf    — Cloudflare's `web-bot-auth` (JS), its own sign() / verify() with its own key handling
//   py    — `http-message-signatures` (pyauth, Python) + `cryptography`, pinned with hashes
//           (interop/py/requirements.lock), driven by interop/py/pyhms_driver.py
//
// Every implementation signs every scenario and every implementation verifies every signature,
// over the Web Bot Auth profile: Ed25519, dictionary Signature-Agent (directory and cimd),
// tag="web-bot-auth", @authority + "signature-agent";key=<label>, and @method/@path/
// content-digest on state-changing requests, with created/expires/nonce/keyid. Tampered and
// wrong-key signatures are refused by every verifier.
//
// pyauth 2.0.1 needs a small conformance shim (ConformantResolver in the driver) for three
// RFC 9421 bugs. Each bug is reproduced here UNPATCHED and must keep reproducing while the pin
// stands; when a pin bump fixes one upstream, its test flips and the shim for it goes. Upstream
// report drafts: docs/outbox/2026-09-30-pyhms-*.md. If an implementation cannot be run at all
// (no Python, install fails), every test fails: interop is never claimed with one side missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sign as cfSign, verify as cfVerify, generateNonce } from "web-bot-auth";
import { signerFromJWK, verifierFromJWK } from "web-bot-auth/crypto";
import { component } from "http-message-sig";
import { createGate, generateSiteKey } from "@ludion/gate-core";
import { createDiverSigner, cardDocument, directoryDocument, DIRECTORY_MEDIA_TYPE, HTTP_MESSAGE_SIGNATURES_DIRECTORY } from "@ludion/diver";
import { ensureVenv, runJson } from "./python.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(HERE, "py", "pyhms_driver.py");
const LOCK = path.join(HERE, "py", "requirements.lock");
const PINS = { "web-bot-auth": "0.2.0", "http-message-signatures": "2.0.1", cryptography: "50.0.1" };

const AGENT = "https://agent.example";
const DIRECTORY_URL = `${AGENT}${HTTP_MESSAGE_SIGNATURES_DIRECTORY}`;
const CARD_URL = `${AGENT}/card`;
const SITE_HOST = "shop.example";

// ── keys ──────────────────────────────────────────────────────────────────────────────
async function keypair() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const { x, d } = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const kid = createHash("sha256").update(JSON.stringify({ crv: "Ed25519", kty: "OKP", x })).digest("base64url");
  return { kid, publicJwk: { kty: "OKP", crv: "Ed25519", x, kid }, privateJwk: { kty: "OKP", crv: "Ed25519", x, d, kid } };
}
const agentKey = await keypair();   // published in the agent's directory and card
const otherKey = await keypair();   // never published: "wrong key" signs with it

// ── the agent's published documents, served from memory to our Gate's resolver ─────────
const directory = directoryDocument([agentKey.publicJwk]);
const card = cardDocument({ origin: AGENT, name: "STD-3 Agent", contacts: ["mailto:ops@agent.example"] });
async function memoryFetch(input) {
  const url = String(input);
  if (url === DIRECTORY_URL) return new Response(JSON.stringify(directory), { status: 200, headers: { "content-type": DIRECTORY_MEDIA_TYPE, "cache-control": "max-age=300" } });
  if (url === CARD_URL) return new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=300" } });
  return new Response("", { status: 404 });
}

// ── scenarios over the Web Bot Auth profile ─────────────────────────────────────────────
const digestOf = (body) => `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
const SCENARIOS = {
  "GET, directory": { method: "GET", url: "https://shop.example/products?q=camera", agent: `sig1="${AGENT}"`, identifier: DIRECTORY_URL },
  "GET, cimd card": { method: "GET", url: "https://shop.example/", agent: `sig1="${CARD_URL}";type=cimd`, cimd: true, identifier: CARD_URL },
  "POST JSON": { method: "POST", url: "https://shop.example/checkout/1", body: '{"sku":"cam-1","qty":1}', agent: `sig1="${AGENT}"`, identifier: DIRECTORY_URL },
  "PUT, encoded path + query": { method: "PUT", url: "https://shop.example/cart/a%20b?x=1", body: "qty=2", agent: `sig1="${AGENT}"`, identifier: DIRECTORY_URL },
};
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const componentsOf = (s) => ["@authority", '"signature-agent";key="sig1"', ...(STATE_CHANGING.has(s.method) ? ["@method", "@path", "content-digest"] : [])];
/** The unsigned fields of a scenario: Signature-Agent, and Content-Digest for a body. */
const baseFields = (s) => [["signature-agent", s.agent], ...(s.body != null ? [["content-digest", digestOf(s.body)]] : [])];
const lifetime = () => { const created = Math.floor(Date.now() / 1000); return { created, expires: created + 60 }; };

/** A signed request: { method, url, headers: [[name, value]] } — the one shape every side reads. */
const withSignature = (s, fields, sigInput, sig) => ({ method: s.method, url: s.url, headers: [...fields, ["signature-input", sigInput], ["signature", sig]] });
const descriptor = (r) => ({ kind: "request", method: r.method, targetUri: r.url, fields: r.headers.map(([name, value]) => ({ name, value })) });

// ── signers ─────────────────────────────────────────────────────────────────────────────
const signers = {
  async ours(s) {
    const signer = await createDiverSigner({ sessionPrivateJwk: agentKey.privateJwk, signatureAgent: AGENT, cimd: !!s.cimd });
    const h = await signer.headersFor({ method: s.method, url: s.url, headers: {}, body: s.body });
    return { method: s.method, url: s.url, headers: Object.entries(h) };
  },
  async cf(s, { key = agentKey, claimKid } = {}) {
    const inner = await signerFromJWK(key.privateJwk);
    const signer = claimKid ? { algorithm: inner.algorithm, keyid: claimKid, sign: (b) => inner.sign(b) } : inner;
    const fields = baseFields(s);
    const { created, expires } = lifetime();
    const out = await cfSign(descriptor({ method: s.method, url: s.url, headers: fields }), {
      signer, label: "sig1", signatureAgentKey: "sig1", created: new Date(created * 1000), expires: new Date(expires * 1000), nonce: generateNonce(),
      additionalComponents: STATE_CHANGING.has(s.method) ? ["@method", "@path", "content-digest"] : [],
    });
    return withSignature(s, fields, out.signatureInput, out.signature);
  },
};
/** The Python side works in batches (one interpreter per batch). */
async function pySign(list, { patched = true } = {}) {
  const ops = list.map(({ s, key = agentKey, claimKid, components }) => {
    const { created, expires } = lifetime();
    return { op: "sign", jwk: key.privateJwk, keyid: claimKid ?? key.kid, request: { method: s.method, url: s.url, headers: baseFields(s) }, label: "sig1",
      components: components ?? componentsOf(s), created, expires, nonce: generateNonce(), tag: "web-bot-auth", patched };
  });
  const { results } = await runJson(await python, DRIVER, { ops });
  return results.map((r, i) => {
    if (!r.ok) throw new Error(`py sign failed: ${r.error}`);
    return withSignature(list[i].s, ops[i].request.headers, r["signature-input"], r.signature);
  });
}

// ── verifiers ───────────────────────────────────────────────────────────────────────────
async function newGate() {
  const siteKey = await generateSiteKey();
  return createGate({ siteId: "site-std3", siteKey: siteKey.privateJwk, authorities: [SITE_HOST], resolver: { fetch: memoryFetch } });
}
const verifiers = {
  /** Our Gate: VERIFIED, identified as the scenario's directory or card URL. */
  async ours(r, s, gate) {
    // The bytes an adapter hands the Gate: a covered Content-Digest is checked against them (GATE-11).
    const { cls } = await (gate ?? await newGate()).inspect({ ...descriptor(r), ...(s.body != null ? { body: s.body } : {}) });
    const ok = cls.class === "VERIFIED" && cls.identifier === s.identifier;
    return { ok, why: ok ? undefined : `${cls.class} ${cls.reason ?? ""} ${cls.detail ?? ""} ${cls.identifier ?? ""}`.trim() };
  },
  /** Cloudflare's verify(), with its own verifierFromJWK over the agent's published key. */
  async cf(r) {
    try {
      const v = await cfVerify(descriptor(r), { resolver: async (cand) => {
        const k = directory.keys.find((x) => x.kid === cand.keyid);
        if (!k) throw new Error(`unknown keyid ${cand.keyid}`);
        return verifierFromJWK({ kty: k.kty, crv: k.crv, x: k.x });
      } });
      return { ok: v.keyid === agentKey.kid && v.tag === "web-bot-auth" };
    } catch (e) { return { ok: false, why: `${e.code ?? ""} ${e.message}`.trim() }; }
  },
};
async function pyVerify(list, { patched = true } = {}) {
  const keys = Object.fromEntries(directory.keys.map((k) => [k.kid, { kty: k.kty, crv: k.crv, x: k.x }]));
  const { results } = await runJson(await python, DRIVER, { ops: list.map((r) => ({ op: "verify", keys, request: r, tag: "web-bot-auth", patched })) });
  return results.map((x) => ({ ok: !!x.ok, why: x.error }));
}

// The pinned Python. Awaited inside every test, so a missing or broken Python fails them all.
const python = Promise.resolve().then(() => ensureVenv(LOCK));
python.catch(() => {});

/** Sign every scenario with every implementation. */
async function signAll() {
  const names = Object.keys(SCENARIOS);
  const out = {};
  for (const n of names) out[n] = { ours: await signers.ours(SCENARIOS[n]), cf: await signers.cf(SCENARIOS[n]) };
  const py = await pySign(names.map((n) => ({ s: SCENARIOS[n] })));
  names.forEach((n, i) => { out[n].py = py[i]; });
  return out;
}

test("STD-3: all three implementations run, at the pinned versions", async (t) => {
  const { results: [v] } = await runJson(await python, DRIVER, { ops: [{ op: "version" }] });
  assert.equal(v.ok, true, v.error);
  assert.equal(v["http-message-signatures"], PINS["http-message-signatures"]);
  assert.equal(v.cryptography, PINS.cryptography);
  const { createRequire } = await import("node:module");
  const fs = await import("node:fs");
  const entry = createRequire(import.meta.url).resolve("web-bot-auth"); // …/web-bot-auth/dist/index.cjs
  const cfPkg = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), "..", "package.json"), "utf8"));
  assert.equal(cfPkg.name, "web-bot-auth");
  assert.equal(cfPkg.version, PINS["web-bot-auth"]);
  t.diagnostic(`implementations: ours (@ludion/diver + @ludion/gate-core), web-bot-auth ${cfPkg.version} (JS), http-message-signatures ${v["http-message-signatures"]} + cryptography ${v.cryptography} (Python ${v.python})`);
});

test("STD-3: every implementation's signature verifies in every implementation (4 scenarios × 3 × 3)", async (t) => {
  const signed = await signAll();
  const failures = [];
  let pairs = 0;
  const pyBatch = [];
  for (const [name, bySigner] of Object.entries(signed)) {
    for (const [signer, r] of Object.entries(bySigner)) {
      for (const v of ["ours", "cf"]) {
        const res = await verifiers[v](r, SCENARIOS[name]);
        pairs++;
        if (!res.ok) failures.push(`${signer} → ${v} (${name}): ${res.why}`);
      }
      pyBatch.push({ name, signer, r });
    }
  }
  const py = await pyVerify(pyBatch.map((x) => x.r));
  py.forEach((res, i) => { pairs++; if (!res.ok) failures.push(`${pyBatch[i].signer} → py (${pyBatch[i].name}): ${res.why}`); });
  assert.deepEqual(failures, [], `interop failures:\n${failures.join("\n")}`);
  assert.equal(pairs, 36);
  t.diagnostic(`interop: ${pairs}/36 signer→verifier pairs VERIFIED`);
});

test("STD-3: a tampered signature is refused by every verifier, whoever signed it", async () => {
  const s = SCENARIOS["POST JSON"];
  const signed = { ours: await signers.ours(s), cf: await signers.cf(s), py: (await pySign([{ s }]))[0] };
  // The body is swapped after signing: Content-Digest (covered) now describes other bytes.
  const tamper = (r) => ({ ...r, headers: r.headers.map(([n, v]) => [n, n === "content-digest" ? digestOf('{"sku":"tv-9","qty":50}') : v]) });
  const problems = [];
  for (const [signer, r] of Object.entries(signed)) {
    const bad = tamper(r);
    for (const v of ["ours", "cf"]) if ((await verifiers[v](bad, s)).ok) problems.push(`${signer} → ${v} accepted a tampered request`);
    if ((await pyVerify([bad]))[0].ok) problems.push(`${signer} → py accepted a tampered request`);
    // and the untampered original still verifies everywhere (the tamper is the only difference)
    for (const v of ["ours", "cf"]) if (!(await verifiers[v](r, s)).ok) problems.push(`${signer} → ${v} refused the original`);
    if (!(await pyVerify([r]))[0].ok) problems.push(`${signer} → py refused the original`);
  }
  assert.deepEqual(problems, []);
});

test("STD-3: a signature by an unpublished key claiming the agent's keyid is refused by every verifier", async () => {
  const s = SCENARIOS["GET, directory"];
  const forged = [await signers.cf(s, { key: otherKey, claimKid: agentKey.kid }), (await pySign([{ s, key: otherKey, claimKid: agentKey.kid }]))[0]];
  const problems = [];
  for (const [i, r] of forged.entries()) {
    const who = ["cf", "py"][i];
    assert.match(r.headers.find(([n]) => n === "signature-input")[1], new RegExp(`keyid="${agentKey.kid}"`), `${who} claims the agent's keyid`);
    for (const v of ["ours", "cf"]) if ((await verifiers[v](r, s)).ok) problems.push(`${who}-forged → ${v} accepted`);
    if ((await pyVerify([r]))[0].ok) problems.push(`${who}-forged → py accepted`);
  }
  assert.deepEqual(problems, []);
});

// ── upstream mismatches, reproduced unpatched (docs/outbox/2026-09-30-pyhms-*.md) ───────

test("STD-3: upstream pyauth#1 (RFC 9421 §2.1.2) — unpatched, `;key` is ignored, so Web Bot Auth fails both ways", async () => {
  const s = SCENARIOS["GET, directory"];
  const [unpatchedSig] = await pySign([{ s }], { patched: false });
  assert.equal((await verifiers.cf(unpatchedSig, s)).ok, false, "cf refuses the unpatched Python signature");
  assert.equal((await verifiers.ours(unpatchedSig, s)).ok, false, "our Gate refuses the unpatched Python signature");
  const ours = await signers.ours(s);
  const [unpatchedVerdict] = await pyVerify([ours], { patched: false });
  assert.equal(unpatchedVerdict.ok, false, "unpatched Python refuses our signature");
  // Control: the identical flow with the member resolved per §2.1.2 interoperates.
  const [patchedSig] = await pySign([{ s }]);
  assert.equal((await verifiers.cf(patchedSig, s)).ok, true);
  assert.equal((await pyVerify([ours]))[0].ok, true);
});

test("STD-3: upstream pyauth#2 (RFC 9421 §2.2.3) — unpatched, @authority keeps an explicit default port", async () => {
  // No Signature-Agent here, so the only difference between the two URLs is the default port.
  // The verifier sees the request as a client sends it: without the explicit :443.
  const fieldsless = async (url, patched) => {
    const { created, expires } = lifetime();
    const { results: [r] } = await runJson(await python, DRIVER, { ops: [{ op: "sign", jwk: agentKey.privateJwk, keyid: agentKey.kid, request: { method: "GET", url, headers: [] },
      label: "sig1", components: ["@authority"], created, expires, nonce: generateNonce(), tag: "web-bot-auth", patched }] });
    assert.equal(r.ok, true, r.error);
    return { method: "GET", url: url.replace(":443", ""), headers: [["signature-input", r["signature-input"]], ["signature", r.signature]] };
  };
  assert.equal((await verifiers.cf(await fieldsless("https://shop.example:443/products", false))).ok, false, "unpatched: authority signed as shop.example:443");
  assert.equal((await verifiers.cf(await fieldsless("https://shop.example/products", false))).ok, true, "control: same request without the explicit port");
  assert.equal((await verifiers.cf(await fieldsless("https://shop.example:443/products", true))).ok, true, "patched: default port omitted per §2.2.3");
});

test("STD-3: upstream pyauth#3 (RFC 9421 §2.2.6) — unpatched, @path of an empty path is empty instead of /", async () => {
  const signPath = async (url, patched) => {
    const { created, expires } = lifetime();
    const { results: [r] } = await runJson(await python, DRIVER, { ops: [{ op: "sign", jwk: agentKey.privateJwk, keyid: agentKey.kid, request: { method: "GET", url, headers: [] },
      label: "sig1", components: ["@authority", "@path"], created, expires, nonce: generateNonce(), tag: "web-bot-auth", patched }] });
    assert.equal(r.ok, true, r.error);
    return { method: "GET", url, headers: [["signature-input", r["signature-input"]], ["signature", r.signature]] };
  };
  assert.equal((await verifiers.cf(await signPath("https://shop.example", false))).ok, false, "unpatched: @path signed as \"\"");
  assert.equal((await verifiers.cf(await signPath("https://shop.example/", false))).ok, true, "control: explicit /");
  assert.equal((await verifiers.cf(await signPath("https://shop.example", true))).ok, true, "patched: empty path is / per §2.2.6");
});

test("STD-3: upstream pyauth#4 (packaging) — http_sfv imports typing_extensions, which the package does not declare", async () => {
  const { results: [v] } = await runJson(await python, DRIVER, { ops: [{ op: "version" }] });
  assert.equal(v.http_sfv_imports_typing_extensions, true, "the vendored http_sfv imports typing_extensions");
  assert.ok(!v.requires.some((r) => /^typing[-_]extensions\b/i.test(r)), `declared requirements: ${v.requires.join(", ")}`);
  // requirements.lock pins typing-extensions explicitly for this reason.
});
