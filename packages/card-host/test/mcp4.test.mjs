// MCP-4 (±): the Card Host never serves a card or a client document whose token_endpoint_auth_method
// is anything but "private_key_jwt" (the human's decision, 2026-10-04, after MCP-3). An agent's
// client_id is public; only the agent's key at the token endpoint keeps another from using it, and that
// holds only while the document says so (MCP-3 showed a "none" document on a permissive server gets a
// token without a key).
//   - The production Worker (worker.mjs) in front of the real Registry: agents registered with
//     statements that ask for a public client, a secret, or another method get documents that say
//     "private_key_jwt" all the same — the Registry keeps no such field and the documents are built
//     in code.
//   - The Card Host itself: given a card or a client document that says anything else (none, a secret
//     method, mTLS, a different case, a padded value, nothing at all), it serves neither, and says why
//     without echoing the document; the same document saying "private_key_jwt" is served.
import { test } from "node:test";
import assert from "node:assert/strict";
import cardWorker from "../worker.mjs";
import { createCardHost, CARD_PATH, CLIENT_PATH, DIRECTORY_PATH, TOKEN_AUTH_METHOD } from "../src/index.mjs";
import registryWorker, { RegistryState } from "../../../services/registry/worker.mjs";
import { memoryStorage } from "../../../services/registry/src/durable.mjs";
import { diverStore } from "../../../services/registry/test/support.mjs";
import { createRegistryClient, signRootStatement, cardDocument, clientDocument } from "@ludion/diver";
import { generateRegistryKey } from "@ludion/gate-core/staple";

const ASKS = [
  { token_endpoint_auth_method: "none" },
  { token_endpoint_auth_method: "client_secret_basic", client_secret: "s3cret" },
  { token_endpoint_auth_method: "client_secret_post" },
  { token_endpoint_auth_method: "tls_client_auth" },
];

test("MCP-4: through the Registry and the production Card Host, every agent's card and client document say private_key_jwt — whatever its registration asked for", async () => {
  const key = await generateRegistryKey();
  const env = { REGISTRY_SIGNING_KEY: JSON.stringify(key.privateJwk), REGISTRY_ORIGIN: "https://registry.ludion.ai", REGISTRY_ISSUER: "https://registry.ludion.ai" };
  const durable = new RegistryState({ storage: memoryStorage() }, env);
  const ns = { REGISTRY: { idFromName: (n) => n, get: () => durable } };
  const reg = (url, init) => registryWorker.fetch(new Request(url, init), ns);
  const client = createRegistryClient({ url: "https://registry.ludion.ai", fetch: reg });
  const hosts = [];
  for (const ask of [{}, ...ASKS]) {
    const d = await diverStore("MCP-4 agent");
    d.store.signature_agent = `https://${d.store.diver_id}.agents.ludion.ai`;
    const statement = signRootStatement(d.root, "ludion-register+jwt", {
      sub: d.store.diver_id, root: { kty: "OKP", crv: "Ed25519", x: d.root.x }, signature_agent: d.store.signature_agent,
      name: d.store.name, contacts: d.store.contacts, iat: Math.floor(Date.now() / 1000), ...ask,
    });
    const r = await reg("https://registry.ludion.ai/v0/divers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statement }) });
    assert.equal(r.status, 201, await r.text());
    await client.approveKeys(d.store, d.root, [{ kty: "OKP", crv: "Ed25519", x: d.session.x }]);
    hosts.push(`${d.store.diver_id}.agents.ludion.ai`);
  }
  for (const host of hosts) for (const p of [CARD_PATH, CLIENT_PATH]) {
    const r = await cardWorker.fetch(new Request(`https://${host}${p}`), ns);
    assert.equal(r.status, 200, `${host}${p}`);
    const doc = await r.json();
    assert.equal(doc.token_endpoint_auth_method, TOKEN_AUTH_METHOD, `${host}${p}`);
    assert.equal(doc.client_secret, undefined, `${host}${p}`);
    assert.equal(doc.jwks_uri, `https://${host}${DIRECTORY_PATH}`, "the keys it proves itself with");
  }
  console.log(`MCP-4: ${hosts.length} agents (${ASKS.length} registered asking for another method); every /card and /client says private_key_jwt with jwks_uri`);
});

test("MCP-4: the Card Host serves no card and no client document that says anything but private_key_jwt", async () => {
  const host = "dvr-aaaaaaaaaaaaaaaa.agents.ludion.ai", origin = `https://${host}`;
  const good = { card: cardDocument({ origin, name: "A", contacts: [] }), client: clientDocument({ origin, name: "A" }) };
  const serve = (docs) => createCardHost({ lookup: (h) => (h === host ? { directory: { keys: [] }, ...docs } : undefined) });
  for (const p of [CARD_PATH, CLIENT_PATH]) assert.equal((await serve(good).fetch(new Request(`${origin}${p}`))).status, 200, `control ${p}`);
  const values = ["none", "client_secret_basic", "client_secret_post", "client_secret_jwt", "tls_client_auth", "self_signed_tls_client_auth", "PRIVATE_KEY_JWT", " private_key_jwt", "private_key_jwt ", "", null, undefined, ["private_key_jwt"]];
  const served = [];
  for (const v of values) {
    for (const [which, p] of [["card", CARD_PATH], ["client", CLIENT_PATH]]) {
      const doc = { ...good[which] };
      if (v === undefined) delete doc.token_endpoint_auth_method; else doc.token_endpoint_auth_method = v;
      const r = await serve({ ...good, [which]: doc }).fetch(new Request(`${origin}${p}`));
      const body = await r.text();
      if (r.status === 200 || body.includes(doc.client_id) || !/not_private_key_jwt/.test(body)) served.push(`${which} with ${JSON.stringify(v)} → ${r.status} ${body.slice(0, 60)}`);
    }
  }
  assert.deepEqual(served, []);
  // The directory is not a client document: the keys are still served (a Gate verifying a signature needs them).
  const bad = { ...good, card: { ...good.card, token_endpoint_auth_method: "none" } };
  assert.equal((await serve(bad).fetch(new Request(`${origin}${DIRECTORY_PATH}`))).status, 200);
  console.log(`MCP-4 planted: ${values.length} values × card and client refused, the control served`);
});
