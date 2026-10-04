// clientAssertion: the private_key_jwt an agent sends to an MCP token endpoint (ADR-039, RFC 7523).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { generateEd25519, clientAssertion, cardDocument, LOOPBACK_REDIRECT_URIS } from "../src/index.mjs";

const CARD = "https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai/card";
const part = (jws, i) => JSON.parse(Buffer.from(jws.split(".")[i], "base64url").toString("utf8"));

test("client assertion: EdDSA over the session key, iss = sub = the card URL, aud the token endpoint, short-lived, a fresh jti", async () => {
  const s = await generateEd25519();
  const a = clientAssertion(s.privateJwk, { clientId: CARD, audience: "https://as.example/token", now: 1_800_000_000 });
  assert.deepEqual(part(a, 0), { alg: "EdDSA", kid: s.kid, typ: "JWT" });
  const p = part(a, 1);
  assert.deepEqual({ ...p, jti: "x" }, { iss: CARD, sub: CARD, aud: "https://as.example/token", jti: "x", iat: 1_800_000_000, exp: 1_800_000_060 });
  assert.match(p.jti, /^[A-Za-z0-9_-]{22}$/);
  const [h, b, sig] = a.split(".");
  const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: s.publicJwk.x }, format: "jwk" });
  assert.ok(verify(null, Buffer.from(`${h}.${b}`), pub, Buffer.from(sig, "base64url")), "verifies under the session public key");
  assert.notEqual(part(clientAssertion(s.privateJwk, { clientId: CARD, audience: "x" }), 1).jti, part(clientAssertion(s.privateJwk, { clientId: CARD, audience: "x" }), 1).jti, "single-use ids");
});

test("client assertion: refuses a public key, a non-https client_id, no audience, a long life", async () => {
  const s = await generateEd25519();
  assert.throws(() => clientAssertion(s.publicJwk, { clientId: CARD, audience: "x" }), /private JWK/);
  assert.throws(() => clientAssertion(s.privateJwk, { clientId: "http://dvr-x.agents.ludion.ai/card", audience: "x" }), /https/);
  assert.throws(() => clientAssertion(s.privateJwk, { clientId: CARD }), /audience/);
  assert.throws(() => clientAssertion(s.privateJwk, { clientId: CARD, audience: "x", lifetimeS: 301 }), /lifetimeS/);
});

test("card: the MCP client metadata — loopback redirects only, code flow, private_key_jwt, never a secret", () => {
  const c = cardDocument({ origin: "https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai", name: "X", contacts: [] });
  assert.equal(c.client_id, CARD);
  assert.deepEqual(c.redirect_uris, ["http://127.0.0.1/callback", "http://[::1]/callback"]);
  assert.deepEqual(c.grant_types, ["authorization_code"]);
  assert.deepEqual(c.response_types, ["code"]);
  assert.equal(c.token_endpoint_auth_method, "private_key_jwt");
  assert.ok(!("client_secret" in c));
  c.redirect_uris.push("https://evil.example/cb");
  assert.deepEqual([...LOOPBACK_REDIRECT_URIS], ["http://127.0.0.1/callback", "http://[::1]/callback"], "each card gets its own copy");
});
