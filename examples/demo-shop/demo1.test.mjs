// DEMO-1 (±): lane 2's demo (docs/lanes/lane2-spec.md §3.4) end to end, with a scripted hijack. The
// demo shop (this folder's server.mjs and its own ludion.config.json) behind the real Node Gate,
// subscribed to a real Registry's revocations; the agent made by the real CLI (init, register, mandate
// create — the operator's passphrase only there); the agent itself run as its own process with no
// passphrase (agent.mjs).
//   1-2. init; mandate create: read and checkout, 3 checkouts a day.
//   3.   browse, look, add to the cart, check out → pass (the Mandate's part: ok).
//   4.   read the reviews, obey the planted text: change the password, close the account → 403
//        mandate_scope.
//   5.   someone with the stolen session key signs by hand (web-bot-auth, no SDK) → still 403
//        mandate_scope outside the Mandate; asks the Registry for a wider Mandate with that key →
//        refused (the Root's signature only).
//   6.   `ludion revoke` → everything REVOKED, at once (the shop subscribes).
// The other side: the same flow at a shop whose account routes name no scope, at a shop that does not
// subscribe to revocations, and against a Registry that takes a session key's statement — each caught
// by the same judge.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateSiteKey } from "@ludion/gate-core";
import { gateConfig } from "@ludion/gate-core/config";
import { generateRegistryKey } from "@ludion/gate-core/staple";
import { ludionGate } from "@ludion/gate-node";
import { registryServer, directoryHost } from "../../services/registry/test/world.mjs";
import { sourceMutant } from "../../services/registry/test/mutant.mjs";
import { demoShop, shopConfig } from "./server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CLI = path.join(ROOT, "packages/diver/bin/ludion.mjs");
const AGENT = path.join(HERE, "agent.mjs");
const SHOP = "shop.example", ORIGIN = `https://${SHOP}`;
const cleanups = [];
after(async () => { for (const c of cleanups.reverse()) { try { await c(); } catch { /* best effort */ } } });

const { LUDION_ROOT_PASSPHRASE: _p, LUDION_DEV: _d, ...BASE_ENV } = process.env;
const OPERATOR_ENV = { ...BASE_ENV, LUDION_ROOT_PASSPHRASE: "the operator's own passphrase, for the demo" };

/** A child process, without blocking this one (the Registry and the shop run here). */
const run = (args, o) => new Promise((resolve) => {
  const c = execFile(process.execPath, args, { ...o, encoding: "utf8", timeout: 60_000 }, (e, stdout, stderr) => resolve({ status: e ? (e.code ?? 1) : 0, stdout, stderr }));
  c.stdin?.end();
});
async function waitFor(pred, ms) {
  const t = Date.now();
  while (!(await pred())) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 25)); }
  return true;
}

/** A Registry: the real one, or a planted one (a mutant of its source) served the same way. */
async function registryOf(planted) {
  if (!planted) { const r = await registryServer({ now: () => Date.now() }); cleanups.push(() => r.close()); return r; }
  const mut = await sourceMutant("services/registry/src", "index.mjs", planted.from, planted.to);
  cleanups.push(mut.cleanup);
  const { nodeListener } = await import(pathToFileURL(path.join(mut.dir, "node.mjs")).href);
  const registry = await mut.mod.createRegistry({ key: (await generateRegistryKey()).privateJwk, sseRetryMs: 200, contactsVerified: true });
  const server = http.createServer(nodeListener(registry, { scheme: "http" }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => { registry.close(); server.closeAllConnections?.(); server.close(); });
  return { registry, url: `http://127.0.0.1:${server.address().port}` };
}

/**
 * The whole demo once. `routes` / `subscribe` / `registry` plant a different shop or Registry.
 * @returns {Promise<{ flow: object[], stolen: object[], revoked: object[], stolenRevoked: object[], jti: string }>}
 */
async function demo({ routes, subscribe = true, registry: planted } = {}) {
  const reg = await registryOf(planted);
  const directory = directoryHost();
  // The shop: its own config, pinned to this Registry, on this test's host name.
  const file = await shopConfig({ fetch: (url) => fetch(String(url).replace("https://registry.ludion.ai", reg.url)) });
  const spec = { ...file, authorities: [SHOP], ...(routes ? { routes } : {}) };
  const cfg = await gateConfig(spec, { siteKey: JSON.stringify((await generateSiteKey()).privateJwk) });
  const mw = await ludionGate({ ...cfg, resolver: { ...cfg.resolver, fetch: directory.fetch }, announce: () => {},
    revocations: subscribe ? { url: `${reg.url}/v0/revocations/stream`, retryMs: 200, maxRetryMs: 1000 } : undefined });
  const server = http.createServer((req, res) => mw(req, res, () => demoShop(req, res)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => { mw.gate.close?.(); server.closeAllConnections?.(); server.close(); });
  if (subscribe) assert.ok(await waitFor(() => mw.gate.health.revocations?.state === "open", 5000), "the shop subscribes to revocations");
  const connect = `http://127.0.0.1:${server.address().port}`;

  // 1-2. The operator: init, register, mandate create (the passphrase is theirs, in their shell).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-demo1-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = async (args) => {
    const r = await run([CLI, ...args], { cwd: dir, env: OPERATOR_ENV });
    assert.equal(r.status, 0, `ludion ${args.join(" ")}: ${r.stdout}${r.stderr}`);
    return r.stdout;
  };
  await cli(["init", "--name", "Demo shopping agent", "--contact", "mailto:ops@example.test", "--no-question"]);
  await cli(["register", "--registry", reg.url]);
  const created = await cli(["mandate", "create", "--site", ORIGIN, "--scope", "read,checkout", "--checkout-max", "5000", "--currency", "JPY", "--per-day", "3", "--expires", "24h"]);
  const jti = /Mandate (mdt-[A-Za-z0-9_-]+)/.exec(created)?.[1];
  directory.publish(JSON.parse(fs.readFileSync(path.join(dir, "ludion.json"), "utf8"))); // what the Card Host serves

  // The agent and the thief: their own processes, no passphrase anywhere.
  const agent = async (mode) => {
    const r = await run([AGENT, `--${mode}`, "--shop", ORIGIN, "--connect", connect, "--registry", reg.url], { cwd: dir, env: BASE_ENV });
    assert.equal(r.status, 0, `agent --${mode}: ${r.stderr}`);
    return r.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  };
  const flow = await agent("scripted");
  const stolen = await agent("stolen");

  // 6. One line ends it.
  const diverId = JSON.parse(fs.readFileSync(path.join(dir, "ludion.json"), "utf8")).diver_id;
  await cli(["revoke"]);
  if (subscribe) await waitFor(() => !!mw.gate.revocations?.match({ sub: diverId }), 5000);
  const revoked = await agent("scripted");
  const stolenRevoked = await agent("stolen");
  return { flow, stolen, revoked, stolenRevoked, jti };
}

/** What is wrong with a run of the demo, against lane 2 spec §3.4. */
export function demoProblems(t) {
  const out = [];
  const step = (list, name) => list.find((s) => s.step === name);
  const want = (list, name, status, error, mandate, cls = "VERIFIED") => {
    const s = step(list, name);
    if (!s) return out.push(`${name}: never happened`);
    const got = `${s.status} ${s.error ?? ""} ${s.class ?? ""} ${s.mandate ?? ""}`.trim();
    if (s.status !== status || (s.error ?? null) !== error || (mandate && s.mandate !== mandate) || (cls && s.class !== cls)) out.push(`${name}: ${got}, want ${status} ${error ?? ""} ${cls ?? ""} ${mandate ?? ""}`.replace(/ +/g, " "));
  };
  // 3. Inside the Mandate.
  for (const name of ["browse", "look", "cart", "checkout", "read reviews (the trap)"]) want(t.flow, name, 200, null, "ok");
  // 4. The page's instructions.
  const obeyed = t.flow.filter((s) => s.step.startsWith("obey the page"));
  if (obeyed.length < 2) out.push(`the hijacked agent tried ${obeyed.length} of the trap's 2 actions`);
  want(t.flow, "obey the page: POST /account/password", 403, "mandate_scope", "scope");
  want(t.flow, "obey the page: POST /account/delete", 403, "mandate_scope", "scope");
  // 5. The stolen session key, by hand.
  want(t.stolen, "stolen key, by hand: inside the Mandate", 200, null, "ok");
  want(t.stolen, "stolen key, by hand: change the password", 403, "mandate_scope", "scope");
  want(t.stolen, "stolen key, by hand: close the account", 403, "mandate_scope", "scope");
  const re = step(t.stolen, "stolen key: ask the Registry for a wider Mandate");
  if (!re || re.status !== 401) out.push(`the Registry gave the stolen session key a wider Mandate: ${re?.status} ${re?.error ?? ""}`);
  // 6. After revoke: every request REVOKED.
  for (const [what, list] of [["the agent", t.revoked], ["the thief", t.stolenRevoked]]) {
    const sent = list.filter((s) => s.method);
    if (!sent.length) out.push(`${what} sent nothing after revoke`);
    for (const s of sent) if (s.status !== 403 || s.error !== "revoked" || s.class !== "REVOKED") out.push(`${what} after revoke, ${s.step}: ${s.status} ${s.error ?? ""} ${s.class ?? ""}`);
  }
  return out;
}

test("DEMO-1: the demo, scripted — in scope passes; the trap's password change and delete get 403 mandate_scope, by the SDK and by hand with the stolen key; no wider Mandate without the Root; revoke stops it all at once", { timeout: 180_000 }, async () => {
  const t = await demo();
  assert.ok(t.jti, "mandate create printed its jti");
  assert.deepEqual(demoProblems(t), []);
  console.log(`DEMO-1: ${t.flow.length} agent steps (${t.flow.filter((s) => s.status === 200).length} passed, ${t.flow.filter((s) => s.error === "mandate_scope").length} mandate_scope), ${t.stolen.length} by the thief, then ${t.revoked.length + t.stolenRevoked.filter((s) => s.method).length} after revoke, all REVOKED`);
});

test("DEMO-1: the judge bites — account routes with no scope, a shop that does not subscribe, a Registry that takes a session key", { timeout: 300_000 }, async () => {
  const file = JSON.parse(fs.readFileSync(path.join(HERE, "ludion.config.json"), "utf8"));
  const planted = [
    ["the account routes name no scope", { routes: file.routes.map((r) => (r.match.startsWith("/account") ? { match: r.match, pressure: 2 } : r)) }],
    ["the shop does not subscribe to revocations", { subscribe: false }],
    ["a Registry that also takes a session key's statement", { registry: { from: "verifyJws(statement, rec.root, { typ })", to: "verifyJws(statement, rec.root, { typ }).catch(() => verifyJws(statement, rec.keys[0], { typ }))" } }],
  ];
  const caught = [];
  for (const [what, o] of planted) caught.push([what, demoProblems(await demo(o)).length > 0]);
  assert.deepEqual(caught.filter(([, c]) => !c).map(([w]) => w), [], "every planted demo is caught");
  console.log(`DEMO-1 planted: ${caught.length}/${planted.length} caught`);
});
