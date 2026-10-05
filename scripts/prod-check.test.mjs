// scripts/prod-check.mjs, the one check per step of docs/DEPLOY.md §0, against a fake fetch: each step
// says OK for the production it is meant to see, and NG — naming the step that fixes it — for each
// way that step can be left undone. Nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKS, PROBE, AGENTS, netProblem } from "./prod-check.mjs";

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const fail = (code, message = "fetch failed") => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(message), { code }) });
/** A fake fetch: routes maps a URL (or a URL prefix ending in *) to a Response, a function or an error. */
function fake(routes) {
  const seen = [];
  const f = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? "GET" });
    const key = url in routes ? url : Object.keys(routes).find((k) => k.endsWith("*") && url.startsWith(k.slice(0, -1)));
    const v = key === undefined ? fail("ENOTFOUND", `getaddrinfo ENOTFOUND ${new URL(url).hostname}`) : routes[key];
    const out = typeof v === "function" ? v(url, init) : v;
    if (out instanceof Error) throw out;
    return out.clone();
  };
  return Object.assign(f, { seen });
}
const NOW = new Date("2026-10-08T00:00:00Z");
const CRT = "https://crt.sh/*";
const card = `https://${PROBE}${AGENTS}/card`;

test("prod-check cert: OK for a live *.agents.ludion.ai certificate in the public logs; NG for none, an expired one, another name, or crt.sh down", async () => {
  const cert = (over = {}) => ({ issuer_name: "C=US, O=Google Trust Services, CN=WE1", name_value: `*${AGENTS}`, not_before: "2026-10-07T10:00:00", not_after: "2027-01-05T10:00:00", ...over });
  const run = (rows) => CHECKS.cert({ fetch: fake({ [CRT]: rows instanceof Error ? rows : json(200, rows) }), now: NOW });
  const good = await run([cert()]);
  assert.equal(good.ok, true, good.lines.join(" "));
  assert.match(good.lines[0], /valid until 2027-01-05/);
  for (const [name, rows, why] of [
    ["none", [], /no certificate/],
    ["expired", [cert({ not_after: "2026-10-01T00:00:00" })], /no certificate/],
    ["not yet valid", [cert({ not_before: "2026-10-09T00:00:00" })], /no certificate/],
    ["another name", [cert({ name_value: "ludion.ai\n*.ludion.ai" })], /no certificate/],
    ["crt.sh down", fail("ECONNRESET"), /could not be read.*Edge Certificates/],
  ]) {
    const r = await run(rows);
    assert.equal(r.ok, false, name);
    assert.match(r.lines.join(" "), why, name);
  }
});

test("prod-check dns: OK once the probe's name resolves over verified TLS; NG says which of §4.2/§4.3 is undone", async () => {
  const url = `https://${PROBE}${AGENTS}/`;
  assert.equal((await CHECKS.dns({ fetch: fake({ [url]: new Response("", { status: 522 }) }) })).ok, true, "any answer before the Card Host");
  for (const [err, why] of [
    [fail("ENOTFOUND"), /Add the DNS record: Type AAAA, Name \*\.agents/],
    [fail("ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE"), /certificate is not Active yet/],
    [fail("ERR_TLS_CERT_ALTNAME_INVALID"), /certificate is not Active yet/],
    [fail("ECONNREFUSED"), /DNS only \(grey cloud\)/],
    [fail("UND_ERR_CONNECT_TIMEOUT"), /DNS only/],
  ]) {
    const r = await CHECKS.dns({ fetch: fake({ [url]: err }) });
    assert.equal(r.ok, false, err.cause.code);
    assert.match(r.lines.join(" "), why, err.cause.code);
  }
});

test("prod-check registry: OK with its key (and the kid keygen printed) and /__card/ closed; NG for no key, another key, an open /__card/, not deployed", async () => {
  const keys = (k) => json(200, { keys: k });
  const routes = (over = {}) => ({ "https://registry.ludion.ai/.well-known/ludion-keys": keys([{ kty: "OKP", kid: "k1" }]),
    [`https://registry.ludion.ai/__card/${PROBE}`]: json(404, { error: "not_found" }), ...over });
  assert.equal((await CHECKS.registry({ fetch: fake(routes()) })).ok, true);
  assert.equal((await CHECKS.registry({ fetch: fake(routes()), kid: "k1" })).ok, true);
  for (const [name, r, kid, why] of [
    ["another key", routes(), "k2", /not the k2 that keygen printed/],
    ["no key", routes({ "https://registry.ludion.ai/.well-known/ludion-keys": keys([]) }), undefined, /--secrets-file/],
    ["open /__card/", routes({ [`https://registry.ludion.ai/__card/${PROBE}`]: json(200, { diver_id: PROBE }) }), undefined, /must not be open/],
    ["not deployed", { "https://registry.ludion.ai/.well-known/ludion-keys": fail("ENOTFOUND") }, undefined, /Deploy the Registry \(§6\.3\)/],
    ["a page, not the Registry", routes({ "https://registry.ludion.ai/.well-known/ludion-keys": new Response("<html>", { status: 404 }) }), undefined, /answered 404/],
  ]) {
    const out = await CHECKS.registry({ fetch: fake(r), kid });
    assert.equal(out.ok, false, name);
    assert.match(out.lines.join(" "), why, name);
  }
});

test("prod-check card-host: OK only for the Card Host's own 404 unknown_agent; NG for a Card Host that cannot ask the Registry, no Card Host, no TLS", async () => {
  assert.equal((await CHECKS["card-host"]({ fetch: fake({ [card]: json(404, { error: "unknown_agent" }) }) })).ok, true);
  for (const [name, res, why] of [
    ["the Registry missing", json(503, { error: "registry_unavailable" }, { "retry-after": "30" }), /deploy the Registry first/],
    ["no Card Host (Cloudflare's error page)", new Response("<html>error code: 522</html>", { status: 522 }), /is ludion-card-host deployed/],
    ["some other 404", new Response("not found", { status: 404 }), /is ludion-card-host deployed/],
    ["a card for the probe", json(200, { client_id: card }), /is ludion-card-host deployed/],
    ["no TLS", fail("ERR_TLS_CERT_ALTNAME_INVALID"), /prod-check\.mjs dns/],
  ]) {
    const out = await CHECKS["card-host"]({ fetch: fake({ [card]: res }) });
    assert.equal(out.ok, false, name);
    assert.match(out.lines.join(" "), why, name);
  }
});

test("prod-check site: OK when ludion.ai serves this checkout's build and init's pages answer; NG names the old build and each page that does not", async () => {
  const pages = (over = {}) => ({ "https://ludion.ai/_build.json": json(200, { site: "0123456789abcdef" }), "https://ludion.ai/api/init-answer": json(405, { allow: "POST" }),
    "https://ludion.ai/*": new Response("<html>", { status: 200 }), ...over });
  const f = fake(pages());
  assert.equal((await CHECKS.site({ fetch: f, hash: "0123456789abcdef" })).ok, true);
  assert.ok(f.seen.every((s) => s.method === "GET"), "GET only: the check sends nothing to init's answer endpoint");
  const old = await CHECKS.site({ fetch: fake(pages({ "https://ludion.ai/_build.json": json(200, { site: "fedcba9876543210" }) })), hash: "0123456789abcdef" });
  assert.equal(old.ok, false);
  assert.match(old.lines.join(" "), /says fedcba9876543210, this checkout's build is 0123456789abcdef: deploy it \(§1\.5\)/);
  const missing = await CHECKS.site({ fetch: fake(pages({ "https://ludion.ai/mandate": new Response("", { status: 404 }), "https://ludion.ai/api/init-answer": new Response("", { status: 404 }) })), hash: "0123456789abcdef" });
  assert.equal(missing.ok, false);
  assert.match(missing.lines.join(" "), /\/mandate answered 404, not 200/);
  assert.match(missing.lines.join(" "), /\/api\/init-answer answered 404, not 405/);
});

test("prod-check: a failed fetch is read by its cause", () => {
  assert.equal(netProblem(fail("EAI_AGAIN")).kind, "dns");
  assert.equal(netProblem(fail("UNABLE_TO_VERIFY_LEAF_SIGNATURE")).kind, "tls");
  assert.equal(netProblem(fail("ETIMEDOUT")).kind, "connect");
  assert.equal(netProblem(Object.assign(new Error("x"), { name: "TimeoutError" })).kind, "connect");
  assert.equal(netProblem(fail("EWHATEVER", "odd")).kind, "other");
});
