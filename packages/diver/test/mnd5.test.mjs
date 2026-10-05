// MND-5 (±, optional in lane 2 spec §3.7): the SDK's own seatbelt. With mandateFor(me, { strict: true }),
// on a site the agent holds a Mandate for, a request names the scope it uses (a GET or HEAD is `read`);
// one outside the Mandate, one naming no scope for a write, and any once the Mandate has expired or been
// withdrawn are never signed and never sent — on a site with no Gate at all (here, a plain server that
// records what reaches it). Inside the Mandate, and on sites with no Mandate, requests go as before.
// The other side: the same judge run on the default (not strict) SDK and on an SDK whose scope check is
// gone sees the out-of-scope requests arrive, and says so.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createDiverSigner, ludionFetch, mandateFor, generateEd25519, MandateScopeError } from "../src/index.mjs";
import { sourceMutant } from "../../../services/registry/test/mutant.mjs";

const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

/** A site with no Gate: it records every request that reaches it. */
async function plainSite() {
  const seen = [];
  const srv = http.createServer((req, res) => { seen.push(`${req.method} ${req.url}`); req.resume(); req.on("end", () => res.end("ok")); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  servers.push(srv);
  return { origin: `http://127.0.0.1:${srv.address().port}`, seen };
}

/** A Mandate as the CLI keeps it (the payload is what the Registry signed; its signature is not read here). */
const kept = (aud, scope, { exp = Math.floor(Date.now() / 1000) + 3600, revoked } = {}) => ({
  jti: `mdt-${scope.join("-")}-test`, aud, scope, iat: Math.floor(Date.now() / 1000), exp, ...(revoked ? { revoked } : {}),
  mandate: `e30.${Buffer.from(JSON.stringify({ aud, scope, exp })).toString("base64url")}.c2ln`,
});

/**
 * What is wrong with an SDK's seatbelt, on a shop it holds read+checkout for, a shop whose Mandate
 * expired, and a site it holds none for. `make(store)` → the `mandate` option for the signer.
 */
async function seatbeltProblems(sdk, make) {
  const [shop, lapsed, other] = [await plainSite(), await plainSite(), await plainSite()];
  const store = { mandates: [kept(shop.origin, ["read", "checkout"]), kept(lapsed.origin, ["read", "checkout"], { exp: Math.floor(Date.now() / 1000) - 60 })] };
  const session = (await generateEd25519()).privateJwk;
  const signer = await sdk.createDiverSigner({ sessionPrivateJwk: session, signatureAgent: "https://agent.example", mandate: make(store) });
  const out = [];
  const send = async (origin, method, path, init = {}) => {
    try { await sdk.ludionFetch(`${origin}${path}`, { method, ...(method === "GET" ? {} : { body: "{}" }), ...init }, { signer }); return "sent"; }
    catch (e) { return e?.name === "MandateScopeError" ? "refused" : `threw ${e?.message}`; }
  };
  const want = async (what, origin, method, path, init, expect) => {
    const before = [shop, lapsed, other].reduce((n, s) => n + s.seen.length, 0);
    const got = await send(origin, method, path, init);
    const arrived = [shop, lapsed, other].reduce((n, s) => n + s.seen.length, 0) - before;
    if (got !== expect || (expect === "refused") !== (arrived === 0)) out.push(`${what}: ${got}, ${arrived} request(s) arrived (want ${expect})`);
  };
  await want("GET inside the Mandate (read)", shop.origin, "GET", "/products", {}, "sent");
  await want("POST to the cart, scope checkout", shop.origin, "POST", "/cart", { scope: "checkout" }, "sent");
  await want("POST /account/password, scope account (outside)", shop.origin, "POST", "/account/password", { scope: "account" }, "refused");
  await want("POST /account/delete naming no scope", shop.origin, "POST", "/account/delete", {}, "refused");
  await want("GET naming delete (outside)", shop.origin, "GET", "/products", { scope: "delete" }, "refused");
  await want("POST where the Mandate expired", lapsed.origin, "POST", "/cart", { scope: "checkout" }, "refused");
  await want("POST to a site with no Mandate", other.origin, "POST", "/contact", {}, "sent");
  return out;
}

test("MND-5: with a Mandate attached, the SDK does not sign a request outside it — not even for a site with no Gate", async () => {
  assert.deepEqual(await seatbeltProblems({ createDiverSigner, ludionFetch }, (store) => mandateFor(store, { strict: true })), []);
  assert.ok(new MandateScopeError("x") instanceof Error);
  console.log("MND-5: inside the Mandate and where there is none, sent; outside it, naming no scope for a write, or after it expired: refused, nothing arrived");
});

test("MND-5: the judge bites — the default SDK, and an SDK whose scope check is gone, let them through", async () => {
  const lax = await seatbeltProblems({ createDiverSigner, ludionFetch }, (store) => mandateFor(store));
  const mut = await sourceMutant("packages/diver/src", "mandate.mjs",
    'if (!allowed.includes(scope)) throw new MandateScopeError(', "if (false) throw new MandateScopeError(");
  after(mut.cleanup);
  const gone = await seatbeltProblems(mut.mod, (store) => mut.mod.mandateFor(store, { strict: true }));
  assert.ok(lax.length > 0, "the default (not strict) SDK is caught");
  assert.ok(gone.length > 0, "an SDK without the scope check is caught");
  console.log(`MND-5 planted: 2/2 caught (${lax.length} and ${gone.length} problems)`);
});
