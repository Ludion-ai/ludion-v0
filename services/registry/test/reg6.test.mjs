// REG-6 (±): spec §8 invariant 14 — trust is not sold: Depth does not rise with money (spec §14.5,
// §18.3). What a Staple says a Diver stands at (Depth, Ballast, how its operator was verified) is a
// function of the confirmed contact and the commitments it signed, and of nothing else:
//   - standingOf, over every combination of those facts, gives the same answer when a record also
//     carries anything money could put there (paid, a plan, a tier, credits, a subscription, a
//     customer id, a "purchased" Depth…) or random fields;
//   - through the real Registry: a registration that claims to have paid, or asserts its own Depth and
//     Ballast, gets the same Staple as one that does not; and a stored record that a billing system
//     wrote a plan into gets the same Staple as before;
//   - the Registry has no route that takes a payment.
// The other side: planted standings that let a plan, a payment, credits, a subscription or a billing
// record raise Depth, Ballast or the operator check are each caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { createRegistryClient, signRootStatement } from "@ludion/diver";
import { standingOf, BALLAST_V0 } from "../src/index.mjs";
import { diverStore, registryWorld, REGISTRY_ORIGIN } from "./support.mjs";

const MONEY = [
  ["paid", true], ["plan", "pro"], ["tier", "enterprise"], ["credits", 1000], ["balance", 5000], ["amount_paid", 99],
  ["subscription", { status: "active", plan: "business" }], ["stripe_customer", "cus_123"], ["billing", { paid: true }],
  ["sponsored", true], ["invoice", "in_1"], ["purchase", { item: "depth", qty: 1 }], ["depth_purchased", 3],
  ["ballast_paid", true], ["payment", { status: "succeeded" }], ["price", 49], ["premium", true], ["verified_paid", true],
];
const FACTS = [];
for (const contact_verified of [false, true]) for (const commitments of [[], [BALLAST_V0[0]], [...BALLAST_V0]]) FACTS.push({ contact_verified, commitments });

/** Deterministic noise: field names and values money is not, to show nothing outside the facts is read. */
function noise(seed) {
  let x = seed;
  const r = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${Math.floor(r() * 1e6)}_${i}`, [true, 7, "x", { a: 1 }, [1]][Math.floor(r() * 5)]]));
}

/**
 * What is wrong with a standing function, for invariant 14: does anything but the facts move it?
 * @param {(rec: object) => object} standing
 * @returns {string[]}
 */
export function moneyProblems(standing) {
  const out = [];
  for (const facts of FACTS) {
    const base = { diver_id: "dvr-aaaaaaaaaaaaaaaa", keys: [], revoked_jkt: [], ...facts };
    const ref = standing(base);
    if (!isDeepStrictEqual(standing({ ...base }), ref)) out.push(`not deterministic at ${JSON.stringify(facts)}`);
    for (const [k, v] of MONEY) {
      const got = standing({ ...base, [k]: v });
      if (!isDeepStrictEqual(got, ref)) out.push(`${k}=${JSON.stringify(v)} moves the standing at ${JSON.stringify(facts)}: ${JSON.stringify(ref)} → ${JSON.stringify(got)}`);
    }
    const all = standing({ ...base, ...Object.fromEntries(MONEY) });
    if (!isDeepStrictEqual(all, ref)) out.push(`every money field at once moves the standing at ${JSON.stringify(facts)}`);
    for (let s = 1; s <= 25; s++) if (!isDeepStrictEqual(standing({ ...base, ...noise(s) }), ref)) out.push(`unrelated fields (seed ${s}) move the standing at ${JSON.stringify(facts)}`);
  }
  return out;
}

const payloadOf = (compact) => JSON.parse(Buffer.from(compact.split(".")[1], "base64url").toString("utf8"));
const standingIn = (p) => ({ depth: p.depth, ballast: p.ballast, op: p.op });

test("REG-6: the standing a Staple carries moves with the confirmed contact and the commitments, and with nothing money could put in a record", () => {
  assert.deepEqual(moneyProblems(standingOf), []);
  // The facts do move it: otherwise the check above would hold for a constant.
  assert.equal(standingOf({ contact_verified: true, commitments: [...BALLAST_V0] }).depth, 1);
  assert.equal(standingOf({ contact_verified: true, commitments: [] }).depth, 0);
  assert.equal(standingOf({ contact_verified: false, commitments: [...BALLAST_V0] }).depth, 0);
  console.log(`REG-6: ${FACTS.length} combinations of the facts × ${MONEY.length} money fields, all at once, and 25 sets of unrelated fields: the standing never moves`);
});

test("REG-6: through the Registry, a registration that says it paid or asserts its own Depth, and a record a billing system wrote a plan into, get the same Staple", async () => {
  const w = await registryWorld({ contactsVerified: true });
  const client = createRegistryClient({ url: REGISTRY_ORIGIN, fetch: w.fetch });
  const plain = await diverStore("Plain agent"), payer = await diverStore("Paying agent");
  await client.register(plain.store, plain.root, { commitments: [...BALLAST_V0] });
  // The payer's statement claims it paid and asserts a higher standing; the Root signature is valid.
  const statement = signRootStatement(payer.root, "ludion-register+jwt", {
    sub: payer.store.diver_id, root: { kty: "OKP", crv: "Ed25519", x: payer.root.x }, signature_agent: payer.store.signature_agent,
    name: payer.store.name, contacts: payer.store.contacts, commitments: [...BALLAST_V0], iat: Math.floor(Date.now() / 1000),
    paid: true, plan: "enterprise", depth: 4, ballast: { status: "active", tier: "b3" }, op: { verified: "domain" }, receipt: "pi_123",
  });
  const r = await w.fetch(`${REGISTRY_ORIGIN}/v0/divers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statement }) });
  assert.equal(r.status, 201, await r.text());
  for (const d of [plain, payer]) await client.approveKeys(d.store, d.root, [d.session]);
  const a = standingIn(payloadOf((await client.staple(plain.store, plain.session)).staple));
  const b = standingIn(payloadOf((await client.staple(payer.store, payer.session)).staple));
  assert.deepEqual(b, a, "the payer's Staple");
  assert.equal(a.depth, 1, "both stand at D1: a confirmed contact and Ballast v0");

  // A billing system writes into the stored record.
  const rec = await w.store.getDiver(payer.store.diver_id);
  await w.store.putDiver(payer.store.diver_id, { ...rec, ...Object.fromEntries(MONEY) });
  const c = standingIn(payloadOf((await client.staple(payer.store, payer.session)).staple));
  assert.deepEqual(c, a, "after a plan was written into the record");

  // No route takes a payment.
  for (const path of ["/v0/billing", "/v0/pay", "/v0/checkout", `/v0/divers/${payer.store.diver_id}/upgrade`, `/v0/divers/${payer.store.diver_id}/depth`, "/v0/plans"]) {
    const res = await w.fetch(`${REGISTRY_ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: "pro", amount: 49 }) });
    assert.ok(res.status === 404 || res.status === 405, `${path}: ${res.status}`);
  }
});

test("REG-6: planted standings that money could raise are caught", () => {
  const up = (s, d = 1) => ({ ...s, depth: s.depth + d });
  const planted = [
    ["a plan raises Depth", (r) => (r.plan === "pro" ? up(standingOf(r), 2) : standingOf(r))],
    ["paying raises Depth by one", (r) => (r.paid ? up(standingOf(r)) : standingOf(r))],
    ["credits buy Ballast", (r) => (r.credits > 0 ? { ...standingOf(r), ballast: { status: "active", tier: "b0", commitments: [...BALLAST_V0] } } : standingOf(r))],
    ["an active subscription stands for a confirmed contact", (r) => standingOf({ ...r, contact_verified: r.contact_verified || r.subscription?.status === "active" })],
    ["a billing record verifies the operator", (r) => ({ ...standingOf(r), op: { verified: r.billing ? "domain" : standingOf(r).op.verified } })],
    ["a purchased Depth", (r) => (r.depth_purchased ? { ...standingOf(r), depth: Math.max(standingOf(r).depth, r.depth_purchased) } : standingOf(r))],
  ];
  const missed = planted.filter(([, f]) => !moneyProblems(f).length).map(([n]) => n);
  assert.deepEqual(missed, []);
  console.log(`REG-6 planted: ${planted.length - missed.length}/${planted.length} caught`);
});
