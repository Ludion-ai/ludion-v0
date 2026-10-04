// BLK-1 (±): a block takes effect with one line of the site's config and is undone by deleting that
// line (spec §12.4, ADR-032), and Ludion's servers have no path to block anyone.
//
// The site runs the real gate-node middleware, configured from the config TEXT it edits
// (site-world.mjs). Every check sends the same five visitors — a person, a Ludion agent, a signed
// agent outside Ludion, a crawler's name in a User-Agent, unnamed automation — and compares whole
// responses: the line stops exactly the one it names, nobody else moves, and the person not by a byte.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateConfig } from "@ludion/gate-core/config";
import { createDecisions } from "@ludion/gate-core";
import { NOW_MS } from "../../gate-core/test/support.mjs";
import { makeWorld, baseConfig, addLine, lineDiff, startSite, visit, outcome, personBytes, VISITORS, IDENTITY, DIVER_ID, SIGNER } from "./site-world.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DECISIONS = /^\s*"decisions": \[$/;
let W, BASE;
before(async () => { W = await makeWorld(); BASE = baseConfig(W); });

/** Every visitor's outcome, and the person's bytes, on a site running `text`. */
async function survey(text, { method = "GET", path: p = "/products/1", now } = {}) {
  const site = await startSite(W, text, { now });
  try {
    const out = {};
    for (const who of VISITORS) out[who] = await visit(site, W, who, method, p);
    // Every visitor must be classified as who it is, or a line that names it proves nothing.
    assert.deepEqual(Object.fromEntries(VISITORS.map((w, i) => [w, site.seen[i]])), IDENTITY, "the visitors are who they are");
    return { outcomes: Object.fromEntries(VISITORS.map((w) => [w, outcome(out[w])])), person: personBytes(out.person), raw: out };
  } finally { await site.close(); }
}

test("BLK-1: one line stops exactly the one it names — a Ludion agent, a signer, a crawler's name, unnamed automation — and deleting it undoes it", async () => {
  const base = await survey(BASE);
  assert.deepEqual(base.outcomes, { person: "ok", diver: "ok", signer: "ok", crawler: "ok", unnamed: "ok" }, "everyone gets in at Pressure 0");
  const lines = { diver: DIVER_ID, signer: SIGNER, crawler: "GPTBot", unnamed: "unnamed" };
  for (const [who, name] of Object.entries(lines)) {
    const line = `    { "who": "${name}", "action": "block" }`;
    const blocked = addLine(BASE, DECISIONS, line);
    assert.deepEqual(lineDiff(BASE, blocked), { added: 1, removed: 0 }, "one line");
    const b = await survey(blocked);
    assert.deepEqual(b.outcomes, { ...base.outcomes, [who]: "blocked_by_site" }, `${name}: blocks ${who} and no one else`);
    assert.equal(b.raw[who].status, 403);
    assert.equal(b.raw[who].link, '<https://ludion.ai/e/blocked_by_site>; rel="help"', "the help link");
    assert.equal(b.person, base.person, "the person's response does not change by a byte");
    const undone = blocked.replace(`\n${line}`, "");
    assert.equal(undone, BASE, "deleting the line restores the file");
    assert.deepEqual((await survey(undone)).outcomes, base.outcomes, `${name}: deleting the line lets ${who} through again`);
  }
  console.log("BLK-1: one line each blocked a Ludion agent, a signer, a crawler's name and unnamed automation, and no one else; deleting it undid it; the person's response never changed");
});

test("BLK-1: the line's scope and end — every write, one route, a read-only route — and an end time that lifts it on its own", async () => {
  const writes = addLine(BASE, DECISIONS, '    { "who": "GPTBot", "action": "block", "scope": "writes" }');
  assert.equal((await survey(writes, { method: "GET" })).outcomes.crawler, "ok", "a read is not a write");
  assert.equal((await survey(writes, { method: "POST" })).outcomes.crawler, "blocked_by_site", "a write is");
  const readOnly = addLine(baseConfig(W, { routes: ['{ "match": "/graphql", "writes": false }', '{ "match": "/checkout/**", "pressure": 2 }'] }), DECISIONS, '    { "who": "GPTBot", "action": "block", "scope": "writes" }');
  assert.equal((await survey(readOnly, { method: "POST", path: "/graphql" })).outcomes.crawler, "ok", 'a POST to a route marked "writes": false only reads');
  const route = addLine(BASE, DECISIONS, '    { "who": "unnamed", "action": "block", "scope": "/login" }');
  assert.equal((await survey(route, { path: "/login" })).outcomes.unnamed, "blocked_by_site");
  assert.equal((await survey(route, { path: "/LOGIN/" })).outcomes.unnamed, "blocked_by_site", "every spelling the app routes there (ADR-021)");
  assert.equal((await survey(route, { path: "/products/1" })).outcomes.unnamed, "ok", "elsewhere, nothing");
  const until = new Date(NOW_MS + 3_600_000).toISOString();
  const timed = addLine(BASE, DECISIONS, `    { "who": "${DIVER_ID}", "action": "block", "until": "${until}" }`);
  assert.equal((await survey(timed)).outcomes.diver, "blocked_by_site", "before the end");
  assert.equal((await survey(timed, { now: () => NOW_MS + 3_600_000 })).outcomes.diver, "ok", "at the end it lifts by itself");
});

test("BLK-1: a malformed line stops the site at start — never a silent let-through or a block of the wrong one", async () => {
  const bad = [
    ['{ "who": "GPTBot", "action": "blok" }', /action must be one of/],
    ['{ "who": "GPTBot", "action": "block", "untill": "2026-10-11T00:00:00Z" }', /unknown key "untill"/],
    ['{ "who": "GPTBot", "action": "block", "until": "7d" }', /a duration such as "7d" has no start/],
    ['{ "who": "GPTBot", "action": "allow" }', /"allow" is for a signed identity/],
    ['{ "who": "unnamed", "action": "allow" }', /"allow" is for a signed identity/],
    [`{ "who": "${DIVER_ID}", "action": "wall" }`, /"wall" is for unnamed automation/],
    ['{ "who": "https://evil.example/blocklist.json", "action": "block" }', /who must be/],
    ['{ "who": "GPTBot", "action": "block", "scope": "checkout" }', /scope must be "writes" or a route/],
  ];
  for (const [line, why] of bad) await assert.rejects(gateConfig(JSON.parse(addLine(BASE, DECISIONS, `    ${line}`))), why, line);
  await assert.rejects(gateConfig({ ...JSON.parse(BASE), decisions: "https://ludion.ai/decisions.json" }), /decisions must be an array/, "a URL is not a list of decisions");
  await assert.rejects(gateConfig({ ...JSON.parse(BASE), blocklist: "https://ludion.ai/blocklist" }), /unknown key "blocklist"/);
});

// ── No path from Ludion's servers ─────────────────────────────────────────────────────────────
// What the Gate reads from the network: key directories (resolver), the Registry's revocation
// stream (revocation.mjs), and the report endpoint's answers (never read: the sink is not awaited).
// None of them may reach a decision: decisions are built once, from the site's config, and the
// only way to blocked_by_site is decide() with one of them.

/** Where the Gate's code could take a decision from anything but the site's config. */
export function serverPaths(files) {
  const out = [];
  for (const [file, src] of files) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/[^\n"'`]*$/gm, "");
    for (const m of code.matchAll(/createDecisions\(([^,)]*)/g)) if (m[1].trim() !== "config.decisions" && !/\bdecisions\.mjs$/.test(file)) out.push(`${file}: decisions from ${m[1].trim()}`);
    if (/["']blocked_by_site["']/.test(code) && !/classify\.mjs$/.test(file)) out.push(`${file}: makes blocked_by_site itself`);
    if (/\bdecisions\b[^;\n]*=\s*[^;\n]*\b(fetch|json\(\)|subscribe|EventSource|WebSocket)\b/.test(code)) out.push(`${file}: decisions from the network`);
    if (/\b(fetch|subscribe\w*)\([^)]*\)[^;\n]*\bdecisions\b/.test(code)) out.push(`${file}: a network answer becomes decisions`);
  }
  return out;
}

function gateSources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "test", "bench", "lib"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name)) out.push([path.relative(ROOT, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")]);
    }
  };
  for (const d of fs.readdirSync(path.join(ROOT, "packages"))) if (d.startsWith("gate-") || d === "ludion") walk(path.join(ROOT, "packages", d));
  return out;
}

test("BLK-1: the judge of server paths catches a Gate that takes its decisions from the network (planted)", () => {
  const planted = [
    ["packages/gate-core/src/index.mjs", "const decisions = createDecisions(await (await fetch(config.blocklist)).json(), { now });"],
    ["packages/gate-core/src/revocation.mjs", "list.decisions = await subscribe(url).then((r) => r.decisions);"],
    ["packages/gate-node/index.mjs", 'if (bad) return res.end(JSON.stringify({ error: "blocked_by_site" }));'],
  ];
  for (const p of planted) assert.ok(serverPaths([p]).length, `not caught: ${p[1]}`);
  assert.deepEqual(serverPaths([["packages/gate-core/src/index.mjs", "const decisions = createDecisions(config.decisions, { now });"]]), [], "the real shape passes");
});

test("BLK-1: in the Gate's code, decisions come only from the site's config, and only decide() makes blocked_by_site", () => {
  const files = gateSources();
  assert.ok(files.length > 20, `read ${files.length} files`);
  assert.deepEqual(serverPaths(files), []);
  const built = files.filter(([, src]) => /createDecisions\(config\.decisions/.test(src)).map(([f]) => f);
  assert.deepEqual(built, ["packages/gate-core/src/index.mjs"], "decisions are built in one place, from config.decisions");
});

test("BLK-1: every network input the Gate reads asks for blocks, and nothing is blocked without the site's line", async () => {
  // Hostile answers: a key directory and a report endpoint that both say "block everyone".
  const hostile = { decisions: [{ who: "unnamed", action: "block" }, { who: "GPTBot", action: "block" }, { who: SIGNER, action: "block" }], blocklist: ["*"] };
  const site = await startSite(W, BASE);
  try {
    await site.gate.resolver.prime({ type: "directory", uri: "https://attacker.example" }, { keys: [{ ...W.other.publicJwk, use: "sig" }], ...hostile });
    const seen = [];
    for (const who of ["signer", "crawler", "unnamed", "diver"]) seen.push([who, outcome(await visit(site, W, who, "POST", "/products/1"))]);
    assert.deepEqual(Object.fromEntries(seen), { signer: "ok", crawler: "ok", unnamed: "ok", diver: "ok" });
  } finally { await site.close(); }
  // A Gate built with no decisions has none, whatever the clock or the classification says.
  const none = createDecisions(undefined, { now: () => NOW_MS });
  for (const cls of [{ class: "SUSPECTED" }, { class: "DECLARED", token: "GPTBot" }, { class: "VERIFIED", identifier: "https://attacker.example", diverId: DIVER_ID }]) {
    assert.equal(none.match(cls, { path: "/", write: true }), null);
  }
  console.log("BLK-1: decisions are built once, from the site's config; a directory that asks for blocks, and the absence of any line, block no one");
});
