// MCP-1 (+) and MCP-2 (−): an agent's card URL is its MCP client_id (spec §11.2, ADR-039), at a real
// authorization server — Keycloak with CIMD on (accept/mcp/keycloak.mjs).
//
// The world is the production path, in process: the Registry's Durable Object (services/registry/
// worker.mjs, in-memory storage) holds the agents; the Card Host Worker (packages/card-host/worker.mjs,
// its default export, unchanged) serves https://dvr-….agents.ludion.ai/card and the key directory over
// TLS. Keycloak fetches the card itself, reads the session key from the card's jwks_uri, and checks
// the agent's private_key_jwt itself.
//
// MCP-1: the card URL is authorized — loopback redirect, PKCE, consent, and a token issued to that
//   client_id for a client assertion signed by the agent's session key.
// MCP-2: what must not get a token does not, each refused at the step that should refuse it — the
//   Root key or a stranger's key at the token endpoint, an assertion for another audience or used
//   twice, a redirect the card does not list, a revoked agent's card.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import cardWorker from "../../packages/card-host/worker.mjs";
import { nodeListener, CARD_PATH, DIRECTORY_PATH } from "../../packages/card-host/src/index.mjs";
import registryWorker, { RegistryState } from "../../services/registry/worker.mjs";
import { memoryStorage } from "../../services/registry/src/durable.mjs";
import { diverStore } from "../../services/registry/test/support.mjs";
import { createRegistryClient, clientAssertion, generateEd25519 } from "@ludion/diver";
import { generateRegistryKey } from "@ludion/gate-core/staple";
import { tools, certificateFor, startKeycloak, createRealm, cimdRealm, refusalsInLog, freePort, KEYCLOAK_VERSION } from "./keycloak.mjs";
import { runFlow, authorizedProblems } from "./flow.mjs";

const T = tools();
const USER = { username: "person", password: "a-long-test-password-7" };
const EXTENSIONS = ["web_bot_auth", "ludion"];
let W;

async function buildWorld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-mcp-"));
  const key = await generateRegistryKey();
  const durable = new RegistryState({ storage: memoryStorage() }, { REGISTRY_SIGNING_KEY: JSON.stringify(key.privateJwk), REGISTRY_ORIGIN: "https://registry.ludion.ai", REGISTRY_ISSUER: "https://registry.ludion.ai" });
  const env = { REGISTRY: { idFromName: (n) => n, get: () => durable } };
  const registry = createRegistryClient({ url: "https://registry.ludion.ai", fetch: (url, init) => registryWorker.fetch(new Request(url, init), env) });
  const agent = async (name) => {
    const d = await diverStore(name);
    d.store.signature_agent = `https://${d.store.diver_id}.agents.ludion.ai`;
    await registry.register(d.store, d.root);
    await registry.approveKeys(d.store, d.root, [{ kty: "OKP", crv: "Ed25519", x: d.session.x }]);
    return { ...d, host: `${d.store.diver_id}.agents.ludion.ai` };
  };
  const agents = { main: await agent("MCP agent"), revoked: await agent("Revoked agent"), plain: await agent("Control agent") };
  await registry.revoke(agents.revoked.store, agents.revoked.root, { reason: "retired" });

  // The Card Host, as deployed. `plain` is a diagnostic control only: its card is served without the
  // Ludion extension fields, to tell a refusal of those fields from any other failure.
  const seen = [];
  const strip = new Set([agents.plain.host]);
  const cardHost = { fetch: async (request) => {
    const u = new URL(request.url);
    const r = await cardWorker.fetch(request, env);
    seen.push({ host: u.hostname, path: u.pathname, status: r.status });
    if (!strip.has(u.hostname) || u.pathname !== CARD_PATH || !r.ok) return r;
    const card = await r.json();
    for (const k of EXTENSIONS) delete card[k];
    return new Response(JSON.stringify(card), { status: 200, headers: r.headers });
  } };
  const tls = certificateFor("*.agents.ludion.ai", { java: T.java, dir });
  const server = https.createServer({ pfx: tls.pfx, passphrase: tls.passphrase }, nodeListener(cardHost));
  const cardPort = await freePort();
  await new Promise((ok) => server.listen(cardPort, "127.0.0.1", ok));
  for (const a of Object.values(agents)) a.clientId = `https://${a.host}:${cardPort}${CARD_PATH}`;

  const kc = await startKeycloak({ java: T.java, kc: T.kc, dir, trust: [tls.pem], hosts: Object.fromEntries(Object.values(agents).map((a) => [a.host, "127.0.0.1"])) });
  await createRealm(kc, cimdRealm({ name: "mcp", user: USER }));
  return {
    kc, agents, seen, issuer: `${kc.url}/realms/mcp`,
    flow: (a, extra = {}) => runFlow({ server: kc.url, realm: "mcp", clientId: a.clientId, user: USER,
      assertion: (audience) => clientAssertion(a.session, { clientId: a.clientId, audience }), ...extra }),
    stop: () => { kc.stop(); server.close(); server.closeAllConnections?.(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

before(async () => { if (!T.missing.length) W = await buildWorld(); }, { timeout: 300_000 });
after(() => W?.stop());

const ready = () => assert.deepEqual(T.missing, [], `missing: ${T.missing.join("; ")}`);

/** Why the card was refused, said plainly, with the control's outcome when the card's extensions are the cause. */
async function diagnose(result) {
  const reasons = refusalsInLog(W.kc.log());
  let control = "";
  if (reasons.some((r) => /unrecognized field/.test(r))) {
    const c = await W.flow(W.agents.plain);
    const p = authorizedProblems(c, { clientId: W.agents.plain.clientId, issuer: W.issuer });
    control = p.length ? ` The control card without ${EXTENSIONS.join(" and ")} fails too: ${p.join("; ")}.`
      : ` The same card without ${EXTENSIONS.join(" and ")} is authorized (token for its URL): Keycloak ${KEYCLOAK_VERSION} rejects metadata it does not know (keycloak/keycloak#51236).`;
  }
  return `${result.steps.join(" → ")}. Keycloak: ${reasons.join("; ") || "(no reason in its log)"}.${control}`;
}

test("MCP-1: the judge refuses a flow that stops short, or a token for another client (planted)", () => {
  const clientId = "https://dvr-aaaaaaaaaaaaaaaa.agents.ludion.ai/card", issuer = "http://127.0.0.1:1/realms/mcp";
  const ok = { stage: "done", token: { token_type: "Bearer" }, claims: { azp: clientId, iss: issuer, exp: Math.floor(Date.now() / 1000) + 60 } };
  assert.deepEqual(authorizedProblems(ok, { clientId, issuer }), []);
  assert.match(authorizedProblems({ stage: "token", error: "invalid_client" }, { clientId, issuer })[0], /stopped at token/);
  assert.match(authorizedProblems({ ...ok, claims: { ...ok.claims, azp: "https://other.example/card" } }, { clientId, issuer })[0], /not https:\/\/dvr-/);
  assert.match(authorizedProblems({ ...ok, claims: { ...ok.claims, iss: "https://elsewhere" } }, { clientId, issuer })[0], /issued by/);
});

test("MCP-1: Keycloak (CIMD on) authorizes the card URL as client_id — loopback redirect, PKCE, consent, private_key_jwt with the session key", { timeout: 120_000 }, async () => {
  ready();
  const a = W.agents.main;
  const r = await W.flow(a);
  const problems = authorizedProblems(r, { clientId: a.clientId, issuer: W.issuer });
  if (problems.length) assert.fail(`${problems.join("; ")}. ${await diagnose(r)}`);
  const fetched = W.seen.filter((s) => s.host === a.host);
  assert.ok(fetched.some((s) => s.path === CARD_PATH && s.status === 200), "Keycloak fetched the card");
  assert.ok(fetched.some((s) => s.path === DIRECTORY_PATH && s.status === 200), "Keycloak fetched the key directory");
  console.log(`MCP-1: Keycloak ${KEYCLOAK_VERSION} (CIMD) issued a token to ${a.clientId.replace(/:\d+\//, "/")} (${r.steps.join(" → ")}); it fetched the card and the directory itself`);
});

/** A flow that must get its code and then be refused a token. */
async function refusedAtToken(r, what) {
  assert.equal(r.stage, "token", `${what}: should get a code and be refused a token; it ${r.stage === "done" ? "got a token" : `stopped at ${r.stage}`}. ${r.stage === "done" ? "" : await diagnose(r)}`);
  assert.match(r.error, /invalid_client|unauthorized_client|invalid_grant/, `${what}: ${r.error}`);
}

test("MCP-2: a key the card does not list cannot redeem the code — the agent's Root key, a stranger's key", { timeout: 120_000 }, async () => {
  ready();
  const a = W.agents.main;
  const stranger = await generateEd25519();
  await refusedAtToken(await W.flow(a, { assertion: (audience) => clientAssertion(a.root, { clientId: a.clientId, audience }) }), "the Root key");
  await refusedAtToken(await W.flow(a, { assertion: (audience) => clientAssertion(stranger.privateJwk, { clientId: a.clientId, audience }) }), "a stranger's key");
});

test("MCP-2: a client assertion for another audience, or one already used, is refused", { timeout: 120_000 }, async () => {
  ready();
  const a = W.agents.main;
  await refusedAtToken(await W.flow(a, { assertion: () => clientAssertion(a.session, { clientId: a.clientId, audience: "https://elsewhere.example/token" }) }), "another audience");
  const first = await W.flow(a);
  assert.equal(first.stage, "done", `control: ${first.error ?? ""} ${first.stage === "done" ? "" : await diagnose(first)}`);
  await refusedAtToken(await W.flow(a, { reuseAssertion: first.assertionUsed }), "a used assertion");
});

/** Run a flow and return it with Keycloak's reasons logged while it ran. */
async function withReasons(run) {
  const mark = W.kc.log().length;
  const r = await run();
  return { r, reasons: refusalsInLog(W.kc.log().slice(mark)) };
}

test("MCP-2: a redirect the card does not list gets no code — refused for the redirect, after the card was read", { timeout: 120_000 }, async () => {
  ready();
  const a = W.agents.main;
  for (const redirect of ["https://attacker.example/callback", "http://127.0.0.1:9/elsewhere"]) {
    const { r, reasons } = await withReasons(() => W.flow(a, { redirect }));
    assert.equal(r.stage, "authorize", `${redirect}: refused before the person logs in (got to ${r.stage}: ${r.error})`);
    assert.ok(reasons.some((x) => /redirect_uri/.test(x)), `${redirect}: refused for another reason — ${reasons.join("; ") || "none logged"}${reasons.some((x) => /unrecognized field/.test(x)) ? `. ${await diagnose(r)}` : ""}`);
  }
});

test("MCP-2: a revoked agent's card URL is refused at the authorization request — its card is gone", { timeout: 120_000 }, async () => {
  ready();
  const a = W.agents.revoked;
  const { r, reasons } = await withReasons(() => W.flow(a));
  assert.equal(r.stage, "authorize", `got to ${r.stage}`);
  assert.ok(W.seen.some((s) => s.host === a.host && s.path === CARD_PATH && s.status === 404), "the Card Host answered 404 for the revoked agent's card");
  assert.ok(reasons.includes("Client Metadata fetch failed") && !reasons.some((x) => /unrecognized field/.test(x)), `refused because the card was not found: ${reasons.join("; ")}`);
});
