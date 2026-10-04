// RPT-2 (±): whether a visit wrote is the Gate's call, made where the site's config is, and nothing
// downstream second-guesses it (spec §12.5, §12.7 "writes": false). A real Gate (gate-core, from the
// site's own ludion.config.json shape) marks /graphql read-only; then:
//   - the per-visit record and the hourly count carry `access` ("read" or "write"); the count has no
//     method at all, and its keys are exactly the route, access, class, decision and operator;
//   - a crawler's name POSTing /graphql is not a suspected fake, and the same name POSTing /contact is;
//     unnamed automation POSTing /graphql is not a critical touch, and POSTing /contact is; a signed
//     agent that said "read" and POSTed /graphql did not contradict itself, and POSTing /contact did;
//   - the report goes by `access` alone: an event whose method says POST but whose access says read is
//     a read to it, and one whose method says GET but whose access says write is a write; an event
//     with no access is skipped, never guessed; and @ludion/report imports no site config.
// The other side: a Gate that ignores "writes": false, a report that reads the method, and a count that
// carries the method are each caught by the same judge.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGate, generateSiteKey, ROW_KEYS } from "@ludion/gate-core";
import { gateConfig } from "@ludion/gate-core/config";
import { createDiverSigner, generateEd25519, directoryDocument } from "@ludion/diver";
import { readEvent, readBatch, summarize, buildReport } from "../src/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = "site-rpt2", ORIGIN = "https://shop.example", AGENT = "https://agent.example";
const SPEC = { site_id: SITE, pressure: 0, routes: [{ match: "/graphql", writes: false }] };
const T0 = Date.parse("2026-10-04T01:00:00Z"), DATE = "2026-10-04";
const GPTBOT = "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";

// The visits, and what is true of each by hand: [who, method, path, how many].
const VISITS = [
  ["crawler", "POST", "/graphql", 3], ["crawler", "POST", "/contact", 2],
  ["unnamed", "POST", "/graphql", 4], ["unnamed", "POST", "/contact", 1],
  ["signed-read", "POST", "/graphql", 2], ["signed-read", "POST", "/contact", 1],
];
const TRUTH = {
  fakes: 2, // the crawler's name on /contact only
  critical: 3, // unproven writes: the crawler and the unnamed on /contact (the signed agent is VERIFIED)
  contradictions: 1, // the signed "read" on /contact only
  access: { "/graphql": "read", "/contact": "write" },
};

async function world() {
  const recs = [], batches = [];
  let t = T0;
  const session = await generateEd25519();
  const directory = directoryDocument([session.publicJwk]);
  const signer = await createDiverSigner({ sessionPrivateJwk: session.privateJwk, signatureAgent: AGENT, now: () => t });
  const config = await gateConfig(SPEC, { siteKey: JSON.stringify((await generateSiteKey()).privateJwk) });
  const fetchDirectory = async (url) => (String(url).startsWith(AGENT)
    ? new Response(JSON.stringify(directory), { headers: { "content-type": "application/http-message-signatures-directory+json" } })
    : new Response("", { status: 404 }));
  const gate = await createGate({ ...config, now: () => t, records: { put: (r) => { recs.push(r); } }, sink: (b) => { batches.push(b); },
    resolver: { ...config.resolver, fetch: fetchDirectory } });
  for (const [who, method, p, n] of VISITS) {
    for (let i = 0; i < n; i++) {
      t += 1000;
      const url = `${ORIGIN}${p}`;
      const headers = who === "crawler" ? { "user-agent": GPTBOT } : who === "unnamed" ? { "user-agent": "python-requests/2.32" }
        : await signer.headersFor({ method, url, headers: { "user-agent": "agent/1" }, purpose: { kind: "read" } });
      await gate.inspect({ kind: "request", method, targetUri: url, fields: Object.entries(headers).map(([name, value]) => ({ name, value })) });
    }
  }
  gate.flush({ all: true });
  await new Promise((r) => setImmediate(r));
  return { recs, batches, rows: batches.flatMap((b) => b.rows) };
}

const reportOf = (lines) => buildReport(lines.map((x) => JSON.stringify(x)).join("\n"), { date: DATE, tz: "UTC", site: SITE });
const fakesOf = (s) => s.suspected_fakes.reduce((n, f) => n + (f.count ?? f.writes ?? 0), 0);

/**
 * What is wrong with the counts and the reports a Gate and the report made, against the truth.
 * @param {{ rows: object[], fromRows: object, fromRecords: object }} x
 */
export function rwProblems({ rows, fromRows, fromRecords }) {
  const out = [];
  const keys = [...ROW_KEYS].sort().join();
  for (const r of rows) {
    if (Object.keys(r).sort().join() !== keys) out.push(`a count with keys ${Object.keys(r).sort().join()} (not ${keys})`);
    const want = TRUTH.access[r.route];
    if (want && r.access !== want) out.push(`${r.route} counted as ${r.access}, the Gate's call is ${want}`);
  }
  for (const [name, s] of [["hourly counts", fromRows], ["records", fromRecords]]) {
    if (fakesOf(s) !== TRUTH.fakes) out.push(`${name}: ${fakesOf(s)} suspected fakes (truth ${TRUTH.fakes})`);
    if (s.critical.unverified !== TRUTH.critical) out.push(`${name}: ${s.critical.unverified} unproven critical touches (truth ${TRUTH.critical})`);
  }
  const said = fromRecords.said_vs_did.reduce((n, x) => n + x.writes, 0);
  if (said !== TRUTH.contradictions) out.push(`records: ${said} writes against a signed "read" (truth ${TRUTH.contradictions})`);
  return out;
}

test("RPT-2: the Gate decides read or write (\"writes\": false is a read); the counts carry it, and the report goes by it alone", async () => {
  const w = await world();
  assert.equal(w.recs.length, VISITS.reduce((n, v) => n + v[3], 0), "every visit recorded");
  for (const r of w.recs) assert.equal(r.access, TRUTH.access[r.route], `record ${r.method} ${r.route}`);
  const problems = rwProblems({ rows: w.rows, fromRows: reportOf(w.batches), fromRecords: reportOf(w.recs) });
  assert.deepEqual(problems, []);
  console.log(`RPT-2: ${w.recs.length} POSTs; /graphql (writes: false) counted as read, /contact as write; ${TRUTH.fakes} suspected fakes, ${TRUTH.critical} unproven critical touches, ${TRUTH.contradictions} contradiction — from the hourly counts and from the records alike`);
});

test("RPT-2: the report reads access, not the method — and skips an event without it; it imports no site config", () => {
  const base = { v: 0, site: SITE, ts: T0 / 1000 + 60, route: "/contact", class: "DECLARED", decision: "allow", pressure: 0, operator: "GPTBot" };
  const said = (x) => summarize([readEvent(x)].filter(Boolean), { site: SITE, date: DATE, tz: "UTC" });
  assert.equal(fakesOf(said({ ...base, method: "POST", access: "read" })), 0, "POST, but the Gate said read");
  assert.equal(fakesOf(said({ ...base, method: "GET", access: "write" })), 1, "GET, but the Gate said write");
  assert.equal(readEvent({ ...base, method: "POST" }), null, "no access: skipped, not guessed from the method");
  assert.equal(readBatch({ v: 0, kind: "ludion.hourly", site: SITE, hour: 1790640000, rows: [{ route: "/contact", method: "POST", class: "DECLARED", decision: "allow", operator: "GPTBot", count: 1 }] }), null,
    "a count with no access is not a count");
  const src = path.join(HERE, "..", "src");
  for (const f of fs.readdirSync(src)) {
    const text = fs.readFileSync(path.join(src, f), "utf8");
    assert.doesNotMatch(text, /gate-core\/config|ludion\.config|gateConfig|readOnly/, `${f} reads the site's config`);
    assert.doesNotMatch(text, /\be\.method\b|\br\.method\b|WRITE_METHODS/, `${f} judges by the method`);
  }
});

test("RPT-2: a Gate that ignores \"writes\": false, a report that reads the method, and a count that carries the method are caught", async () => {
  const w = await world();
  const byMethod = (x) => ({ ...x, access: ["POST", "PUT", "PATCH", "DELETE"].includes(x.method ?? (x.route === "/graphql" || x.route === "/contact" ? "POST" : "GET")) ? "write" : "read" });
  const planted = [
    ["a Gate that ignores writes: false", () => ({
      rows: w.rows.map((r) => ({ ...r, access: "write" })),
      fromRows: reportOf(w.batches.map((b) => ({ ...b, rows: b.rows.map((r) => ({ ...r, access: "write" })) }))),
      fromRecords: reportOf(w.recs.map(byMethod)),
    }), /\/graphql counted as write/],
    ["a report that reads the method", () => ({
      rows: w.rows, fromRows: reportOf(w.batches.map((b) => ({ ...b, rows: b.rows.map(byMethod) }))), fromRecords: reportOf(w.recs.map(byMethod)),
    }), /suspected fakes \(truth 2\)|unproven critical touches \(truth 3\)/],
    ["a count that carries the method", () => ({
      rows: w.rows.map((r) => ({ ...r, method: "POST" })), fromRows: reportOf(w.batches), fromRecords: reportOf(w.recs),
    }), /a count with keys .*method/],
  ];
  const missed = planted.filter(([, make, why]) => !rwProblems(make()).some((p) => why.test(p))).map(([n]) => n);
  assert.deepEqual(missed, []);
  console.log(`RPT-2 planted: ${planted.length - missed.length}/${planted.length} caught`);
});
