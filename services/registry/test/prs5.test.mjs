// PRS-5 (±): Mandate's first use is closing an account (docs/outbox/adr-2026-10-05-mandate-first-use-is-
// delete.md). The demo site (examples/demo-site: its own handler, its own ludion.config.json, its
// Registry keys pinned by its own demoConfig()) behind a real Gate, a real Registry, real agents, and
// a Principal consenting with a (software) passkey:
//   - POST /account/delete lets through only an AI that carries its user's Mandate for this site with
//     scope "delete", and the site answers for the account the Mandate names (the user's pseudonym);
//   - refused with 403 mandate_required: no Mandate, a Mandate for another site, a withdrawn one (the
//     Gate subscribes to revocations); 403 mandate_scope: a Mandate for something else; a Mandate
//     carried by another agent is not its own (SPOOFED); unsigned automation is asked to sign;
//   - people are untouched (the site's own sign-in is theirs), and the rest of the site is open.
// The other side: the same scenario at Gates whose route lacks the scope, sits at Pressure 1, or asks
// for another scope is caught by the same judge.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSiteKey } from "@ludion/gate-core";
import { gateConfig } from "@ludion/gate-core/config";
import { ludionGate } from "@ludion/gate-node";
import { registryServer, agent, directoryHost, testClock } from "./world.mjs";
import { softPasskey, principal } from "./passkey.mjs";
import { demoSite, demoConfig } from "../../../examples/demo-site/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = JSON.parse(fs.readFileSync(path.join(HERE, "../../../examples/demo-site/ludion.config.json"), "utf8"));
const HOST = FILE.authorities[0];
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const cleanups = [];
after(async () => { for (const c of cleanups.reverse()) { try { await c(); } catch { /* best effort */ } } });

async function waitFor(pred, ms) {
  const t = Date.now();
  while (!(await pred())) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 20)); }
  return true;
}

async function world() {
  const clock = testClock();
  const reg = await registryServer({ now: () => clock.now(), sseRetryMs: 200 });
  cleanups.push(() => reg.close());
  const directory = directoryHost();
  const [A, B] = await Promise.all(["A", "B"].map((n) => agent({ registryUrl: reg.url, clock, directory, name: `PRS-5 ${n}` })));
  const P = principal({ registryUrl: reg.url, now: () => clock.now(), passkey: await softPasskey({ alg: -7 }) });
  assert.equal((await P.register()).status, 201);
  // The demo's own config, its Registry keys pinned by its own demoConfig() (here the test Registry answers).
  const config = await demoConfig({ fetch: (url) => fetch(String(url).replace(FILE.registry.issuer, reg.url)) });
  return { clock, reg, directory, A, B, P, config };
}

/** The demo site behind a Gate made from `spec` (the demo's config, or a planted one). */
async function demo(w, spec) {
  const cfg = await gateConfig(spec, { siteKey: JSON.stringify((await generateSiteKey()).privateJwk) });
  const mw = await ludionGate({ ...cfg, now: () => w.clock.now(), resolver: { ...cfg.resolver, fetch: w.directory.fetch },
    revocations: { url: `${w.reg.url}/v0/revocations/stream`, retryMs: 200, maxRetryMs: 1000 }, announce: () => {} });
  const server = http.createServer((req, res) => mw(req, res, () => demoSite(req, res)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => { mw.gate.close?.(); server.closeAllConnections?.(); server.close(); });
  await waitFor(() => mw.gate.health.revocations.state === "open", 5000);
  const send = (pathname, headers, method = "POST") => new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${server.address().port}${pathname}`, { method, headers: { ...headers, host: HOST }, agent: false }, (res) => {
      const c = []; res.on("data", (d) => c.push(d));
      res.on("end", () => { let body = null; try { body = JSON.parse(Buffer.concat(c).toString()); } catch { /* not JSON */ } resolve({ status: res.statusCode, error: res.headers["ludion-error"] ?? null, link: res.headers.link ?? null, body }); });
    });
    req.on("error", reject); req.end();
  });
  return { send, gate: mw.gate };
}

/** Everyone tries POST /account/delete (and the page); what happened to each. */
async function scenario(w, d, { withdraw = true } = {}) {
  const { A, B, P } = w;
  const aud = `https://${HOST}`;
  const t0 = Math.floor(w.clock.now() / 1000);
  const issue = async (fields) => { const r = await P.mandate({ sub: A.store.diver_id, exp: t0 + 3600, ...fields }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
  const del = await issue({ aud, scope: ["delete"] });
  const prn = JSON.parse(Buffer.from(del.mandate.split(".")[1], "base64url").toString()).prn;
  const ai = async (x, mandate, method = "POST", p = "/account/delete") => d.send(p, await x.headers(HOST, p, { method, mandate }), method);
  const out = {
    person: await d.send("/account/delete", { "user-agent": BROWSER, accept: "text/html" }),
    unsigned: await d.send("/account/delete", { "user-agent": "python-requests/2.32" }),
    noMandate: await ai(A),
    otherScope: await ai(A, (await issue({ aud, scope: ["read"] })).mandate),
    otherSite: await ai(A, (await issue({ aud: "https://other.example", scope: ["delete"] })).mandate),
    othersMandate: await ai(B, del.mandate),
    page: await ai(A, undefined, "GET", "/"),
    withMandate: await ai(A, del.mandate),
    prn,
  };
  if (withdraw) {
    assert.equal((await P.revoke(del.jti)).status, 200);
    let r;
    await waitFor(async () => { r = await ai(A, del.mandate); return r.status !== 200; }, 5000);
    out.withdrawn = r;
  }
  return out;
}

/** What is wrong with what the demo site did, against what it must do. */
export function deleteProblems(o, { A }) {
  const out = [];
  const refused = (r, status, error) => r.status === status && r.error === error && r.link === `<https://ludion.ai/e/${error}>; rel="help"`;
  if (!(o.withMandate.status === 200 && o.withMandate.body?.deleted === true && o.withMandate.body.account === o.prn && o.withMandate.body.by === A.store.diver_id)) out.push(`with its user's Mandate: ${JSON.stringify(o.withMandate)}`);
  if (!refused(o.noMandate, 403, "mandate_required")) out.push(`no Mandate: ${o.noMandate.status} ${o.noMandate.error}`);
  if (!refused(o.otherScope, 403, "mandate_scope")) out.push(`a Mandate for something else: ${o.otherScope.status} ${o.otherScope.error}`);
  if (!refused(o.otherSite, 403, "mandate_required")) out.push(`a Mandate for another site: ${o.otherSite.status} ${o.otherSite.error}`);
  if (o.othersMandate.status === 200) out.push(`another agent carrying the Mandate: ${o.othersMandate.status}`);
  if (!refused(o.unsigned, 401, "signature_required")) out.push(`unsigned automation: ${o.unsigned.status} ${o.unsigned.error}`);
  if (o.withdrawn && !refused(o.withdrawn, 403, "mandate_required")) out.push(`a withdrawn Mandate: ${o.withdrawn.status} ${o.withdrawn.error}`);
  if (!(o.person.status === 200 && o.person.error == null && o.person.body?.account === null)) out.push(`a person: ${o.person.status} ${o.person.error}`);
  if (o.page.status !== 200) out.push(`the page, for an AI without a Mandate: ${o.page.status}`);
  return out;
}

test("PRS-5: on the demo site, only an AI with its user's Mandate (scope delete, this site) closes the account — refused without one, for another scope or site, withdrawn, or carried by another agent; people untouched", { timeout: 120_000 }, async () => {
  const w = await world();
  const o = await scenario(w, await demo(w, w.config));
  assert.deepEqual(deleteProblems(o, w), []);
  console.log(`PRS-5: POST /account/delete on the demo site's own config: 200 for the account its user's Mandate names (${o.prn.slice(0, 10)}…); 403 mandate_required without one, for another site, once withdrawn; 403 mandate_scope for another scope; another agent's carry refused; a person and the page untouched`);
});

test("PRS-5: Gates whose route lacks the scope, sits at Pressure 1, or asks for another scope are caught", { timeout: 120_000 }, async () => {
  const w = await world();
  const route = FILE.routes.find((r) => r.match === "/account/delete");
  assert.ok(route, "the demo's config has the route");
  const planted = [
    ["no scope required", { ...route, require: {} }, /no Mandate: 200/],
    ["Pressure 1", { ...route, pressure: 1 }, /no Mandate: 200/],
    ["another scope", { ...route, require: { scope: "account" } }, /with its user's Mandate:/],
  ];
  const missed = [];
  for (const [name, r, why] of planted) {
    const spec = { ...w.config, routes: w.config.routes.map((x) => (x.match === route.match ? r : x)) };
    const problems = deleteProblems(await scenario(w, await demo(w, spec), { withdraw: false }), w);
    if (!problems.some((p) => why.test(p))) missed.push(`${name}: ${problems.join(" | ") || "nothing caught"}`);
  }
  assert.deepEqual(missed, []);
  console.log(`PRS-5 planted: ${planted.length}/${planted.length} caught`);
});
