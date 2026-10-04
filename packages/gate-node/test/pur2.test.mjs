// PUR-2 (−): the note never leaves the Gate (spec §11.7). An agent's sentence stays in the site's own
// records (7 days); it is in no hourly count, no receipt, no response header the Gate sets, no log.
// PRIV-1's method: a canary note, looked for in every byte that leaves — as written, percent-encoded
// (how a Display String carries it), and in base64 and base64url (how a receipt carries JSON).
// The real gate-node middleware and the real HTTP sink, over two hours of a clock the test moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ludionGate } from "../index.mjs";
import { generateSiteKey, memoryRecords } from "@ludion/gate-core";
import { httpSink } from "@ludion/gate-core/config";
import { keypair, signed, NOW_MS, AGENT } from "../../gate-core/test/support.mjs";

const CANARY = "note-canary-7Qx";
const NOTE_JA = "カナリアの文 note-canary-7Qx";

/** Every form the canary could take in bytes that leave. */
export function forms(s) {
  const b = Buffer.from(s, "utf8");
  const pct = [...b].map((x) => (x >= 0x20 && x < 0x7f && x !== 0x25 && x !== 0x22 ? String.fromCharCode(x) : `%${x.toString(16).padStart(2, "0")}`)).join("");
  return [s, pct, pct.toUpperCase(), b.toString("base64"), b.toString("base64url"), encodeURIComponent(s)].filter((x, i, a) => a.indexOf(x) === i);
}
/** Where a canary shows up in what left. */
export function leaks(chunks, canaries) {
  const out = [];
  for (const [where, text] of chunks) for (const c of canaries) for (const f of forms(c)) if (text.includes(f)) out.push(`${where}: ${c}`);
  // base64 of JSON carrying the canary can start at any of three offsets: decode and look again.
  for (const [where, text] of chunks) for (const m of text.matchAll(/[A-Za-z0-9_-]{24,}/g)) {
    const d = Buffer.from(m[0], "base64url").toString("utf8");
    for (const c of canaries) if (d.includes(c)) out.push(`${where} (base64): ${c}`);
  }
  return [...new Set(out)];
}

test("PUR-2: the judge finds a note leaked as written, percent-encoded, or inside base64 (planted)", () => {
  const json = JSON.stringify({ note: CANARY });
  assert.ok(leaks([["sink", `{"x":"${CANARY}"}`]], [CANARY]).length);
  assert.ok(leaks([["header", forms(NOTE_JA)[1]]], [NOTE_JA]).length, "percent-encoded");
  assert.ok(leaks([["receipt", Buffer.from(`{"a":1,${json.slice(1)}`).toString("base64url")]], [CANARY]).length, "inside base64url JSON");
  assert.deepEqual(leaks([["sink", '{"rows":[{"route":"/contact","count":2}]}']], [CANARY]), []);
});

test("PUR-2: an agent's note stays on the site — in its records, and in nothing that leaves", async () => {
  const agent = await keypair();
  const bodies = [];
  const collector = http.createServer((req, res) => { let s = ""; req.on("data", (d) => { s += d; }); req.on("end", () => { bodies.push(s); res.writeHead(204).end(); }); });
  await new Promise((r) => collector.listen(0, "127.0.0.1", r));
  let now = NOW_MS;
  const records = memoryRecords({ now: () => now });
  const logged = [];
  let summary = "";
  const saved = {};
  for (const m of ["log", "info", "warn", "error", "debug"]) { saved[m] = console[m]; console[m] = (...a) => logged.push(a.map(String).join(" ")); }
  try {
    const mw = await ludionGate({
      siteId: "site-pur2", siteKey: (await generateSiteKey()).privateJwk, now: () => now, authorities: ["shop.example"], records,
      sink: httpSink(`http://127.0.0.1:${collector.address().port}/hourly`), sendMetadata: true, announce: (l) => console.info(l),
      resolver: { fetch: async () => new Response("", { status: 404 }) },
    });
    await mw.gate.resolver.prime({ type: "directory", uri: AGENT }, { keys: [{ ...agent.publicJwk, use: "sig" }] });
    const site = http.createServer((req, res) => mw(req, res, () => { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok\n"); }));
    await new Promise((r) => site.listen(0, "127.0.0.1", r));
    const seen = [];
    const send = async (method, path, purpose, cover) => {
      const req = await signed({ key: agent, method, url: `https://shop.example${path}`, created: Math.floor(now / 1000),
        headers: { "ludion-purpose": purpose }, extraComponents: cover ? ["ludion-purpose"] : [] });
      const headers = Object.fromEntries(req.fields.map((f) => [f.name, f.value]));
      await new Promise((ok, no) => {
        const r = http.request({ host: "127.0.0.1", port: site.address().port, method, path, headers: { ...headers, host: "shop.example", "content-length": "0" } }, (res) => {
          let b = ""; res.on("data", (d) => { b += d; });
          res.on("end", () => { seen.push(["response", JSON.stringify(res.rawHeaders) + b]); ok(); });
        });
        r.on("error", no); r.end();
      });
    };
    const ascii = `read; note=%"Compare prices ${CANARY}"`;
    const wide = `act; note=%"${[...Buffer.from(NOTE_JA)].map((x) => (x < 0x80 && x !== 0x25 && x !== 0x22 ? String.fromCharCode(x) : `%${x.toString(16)}`)).join("")}"`;
    for (let h = 0; h < 2; h++) {
      await send("POST", "/contact", ascii, true);   // signed: the agent's own word (and a contradiction)
      await send("POST", "/contact", wide, true);
      await send("POST", "/contact", ascii, false);  // outside the signature: an unsigned claim
      now += 3_600_000;
    }
    await send("GET", "/", ascii, true); // closes the last hour
    mw.gate.flush({ all: true });
    await new Promise((r) => setTimeout(r, 300));
    site.close(); collector.close();
    // On the site: the records keep the sentence, as the agent wrote it.
    const kept = records.list().map((r) => r.purpose?.note);
    assert.ok(kept.includes(`Compare prices ${CANARY}`) && kept.includes(NOTE_JA), "the site's records keep the note");
    assert.ok(bodies.length >= 2, `hourly batches were sent (${bodies.length})`);
    const out = [...bodies.map((b) => ["sink", b]), ...seen, ...logged.map((l) => ["log", l])];
    assert.deepEqual(leaks(out, [CANARY, NOTE_JA, "Compare prices"]), []);
    summary = (`PUR-2: ${records.size} visits' notes kept in the site's records; ${bodies.length} hourly batches, ${seen.length} responses and ${logged.length} log lines carried none of them, in any encoding`);
  } finally { Object.assign(console, saved); }
  console.log(summary);
});
