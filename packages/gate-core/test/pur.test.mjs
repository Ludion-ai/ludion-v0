// PUR-1 (−) and PUR-3 (±), on the real Gate (createGate, spec §11.7, ADR-030):
//   PUR-1: a declaration the verified signature does not cover is an unsigned claim — recorded as
//          such, never matched, never on the receipt, never enough for purpose_required.
//   PUR-3: one rule — said `read` (signed, or by claiming a reading crawler's name) and wrote: a
//          contradiction. Everything else is consistent or undeclared; a read-only route is no write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keypair, signed, harness, SITE } from "./support.mjs";
import { memoryRecords } from "../src/index.mjs";

const agent = await keypair();
const act = 'act; note=%"Add one item to the cart for the user"';
const read = 'read; note=%"Compare prices"';

async function gateWith(routes = []) {
  const records = memoryRecords();
  const gate = await harness({ agentKeys: [agent], routes: [{ match: "/catalog/search", writes: false }, ...routes], records });
  return { gate, records };
}

/** Inspect one request and return its outcome and the record the site keeps. */
async function run(g, req) {
  const r = await g.gate.inspect(req, {});
  const all = g.records.all?.() ?? g.records.list?.() ?? [];
  const rec = all.at(-1) ?? null;
  const receipt = r.headers["Ludion-Receipt"] ? JSON.parse(Buffer.from(r.headers["Ludion-Receipt"], "base64url").toString("utf8")) : null;
  return { r, rec, receipt };
}

/** A signed request whose signature covers Ludion-Purpose (the agent's own word). */
const covered = (method, path, value) => signed({ key: agent, method, url: `${SITE}${path}`, headers: { "ludion-purpose": value }, extraComponents: ["ludion-purpose"] });
/** A signed request carrying Ludion-Purpose outside the signature (anyone on the path could have added it). */
async function uncovered(method, path, value) {
  const req = await signed({ key: agent, method, url: `${SITE}${path}` });
  req.fields.push({ name: "ludion-purpose", value });
  return req;
}
const unsigned = (ua, method, path, value) => ({ kind: "request", method, targetUri: `${SITE}${path}`, fields: [{ name: "user-agent", value: ua }, ...(value ? [{ name: "ludion-purpose", value }] : [])] });

test("PUR-1: a declaration the signature does not cover is an unsigned claim — kept as one, never matched, never on the receipt", async () => {
  const g = await gateWith();
  const own = await run(g, await covered("POST", "/contact", read));
  assert.equal(own.r.cls.class, "VERIFIED");
  assert.deepEqual(own.rec.purpose, { kind: "read", signed: true, note: "Compare prices" }, "control: covered, it is the agent's word");
  assert.equal(own.rec.verdict, "contradiction", "control: and it is matched");
  assert.equal(own.receipt.purpose, "read");
  for (const [name, req] of [["signed request, purpose outside the signature", await uncovered("POST", "/contact", read)],
    ["a crawler-free unsigned request", unsigned("python-requests/2.32", "POST", "/contact", read)]]) {
    const x = await run(g, req);
    assert.equal(x.rec.purpose?.signed, false, `${name}: an unsigned claim`);
    assert.equal(x.rec.verdict, "undeclared", `${name}: never matched`);
    assert.equal(x.receipt.purpose, null, `${name}: not on the receipt`);
  }
  console.log("PUR-1: a covered declaration is the agent's word and matched; outside the signature it is kept as an unsigned claim, never matched, never on the receipt");
});

test("PUR-1: an unsigned declaration does not satisfy purpose_required", async () => {
  const g = await gateWith([{ match: "/contact", pressure: 2, require: { purpose: "act" } }]);
  assert.equal((await run(g, await uncovered("POST", "/contact", act))).r.decision.error, "purpose_required");
  assert.equal((await run(g, await covered("POST", "/contact", act))).r.decision.action, "allow", "control: covered, it does");
});

test("PUR-3: said read and wrote is a contradiction; act and wrote, read and read are consistent; a crawler's name says read", async () => {
  const g = await gateWith();
  const cases = [
    ["signed read, POST", await covered("POST", "/contact", read), { said: "read", said_by: "signature", verdict: "contradiction" }],
    ["signed read, DELETE", await covered("DELETE", "/cart/1", read), { said: "read", said_by: "signature", verdict: "contradiction" }],
    ["signed act, POST", await covered("POST", "/contact", act), { said: "act", said_by: "signature", verdict: "consistent" }],
    ["signed read, GET", await covered("GET", "/products/1", read), { said: "read", said_by: "signature", verdict: "consistent" }],
    ["signed read, POST to a read-only route", await covered("POST", "/catalog/search", read), { said: "read", said_by: "signature", verdict: "consistent" }],
    ["GPTBot (a crawler) POST", unsigned("Mozilla/5.0 (compatible; GPTBot/1.2)", "POST", "/contact"), { said: "read", said_by: "crawler_name", verdict: "contradiction" }],
    ["Googlebot (search) PUT", unsigned("Mozilla/5.0 (compatible; Googlebot/2.1)", "PUT", "/contact"), { said: "read", said_by: "crawler_name", verdict: "contradiction" }],
    ["GPTBot GET", unsigned("Mozilla/5.0 (compatible; GPTBot/1.2)", "GET", "/products/1"), { said: "read", said_by: "crawler_name", verdict: "consistent" }],
    ["ChatGPT-User (a person's fetcher) POST", unsigned("Mozilla/5.0 (compatible; ChatGPT-User/1.0)", "POST", "/contact"), { said: null, said_by: null, verdict: "undeclared" }],
    ["unsigned automation, no declaration, POST", unsigned("python-requests/2.32", "POST", "/contact"), { said: null, said_by: null, verdict: "undeclared" }],
    ["signed, no declaration, POST", await signed({ key: agent, method: "POST", url: `${SITE}/contact` }), { said: null, said_by: null, verdict: "undeclared" }],
  ];
  for (const [name, req, want] of cases) {
    const { rec } = await run(g, req);
    assert.deepEqual({ said: rec.said, said_by: rec.said_by, verdict: rec.verdict }, want, name);
  }
  console.log(`PUR-3: ${cases.length} visits, each judged by the one rule (said read and wrote → contradiction); 0 misjudged`);
});

test("PUR-3: purpose_required asks writes on the site's chosen route for the word it names, and touches nothing else", async () => {
  const g = await gateWith([{ match: "/checkout/**", pressure: 2, require: { purpose: "act" } }, { match: "/reviews", pressure: 2, require: { purpose: "any" } }]);
  const outcome = async (req) => { const { r } = await run(g, req); return r.decision.action === "deny" ? r.decision.error : r.decision.action; };
  assert.equal(await outcome(await signed({ key: agent, method: "POST", url: `${SITE}/checkout/1` })), "purpose_required", "no word");
  assert.equal(await outcome(await covered("POST", "/checkout/1", read)), "purpose_required", "the wrong word");
  assert.equal(await outcome(await covered("POST", "/checkout/1", act)), "allow");
  assert.equal(await outcome(await covered("POST", "/reviews", read)), "allow", '"any" takes either word');
  assert.equal(await outcome(await signed({ key: agent, method: "GET", url: `${SITE}/checkout/1` })), "allow", "a read is not asked");
  assert.equal(await outcome(await signed({ key: agent, method: "POST", url: `${SITE}/contact` })), "allow", "another route is not asked");
  assert.equal(await outcome(unsigned("Mozilla/5.0 (Windows NT 10.0) Chrome/129", "POST", "/checkout/1")), "allow", "a person is never asked");
});

test("PUR-3: a malformed declaration is no declaration", async () => {
  const g = await gateWith();
  for (const v of ["write", "read; note=1", 'act; note=%"x"; extra=1', "read, act", ""]) {
    const { rec } = await run(g, await covered("POST", "/contact", v));
    assert.equal(rec.verdict, "undeclared", JSON.stringify(v));
  }
});
