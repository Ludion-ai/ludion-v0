// ONE-5 (±): a write by something claiming to be a crawler is reported as a suspected fake (spec
// §12.5 rule 2, §12.3), with 0 misjudged on fixed data.
//
// The data, each visit labelled by hand (fake or not):
//   - through the real Gate (gate-core createGate): requests with real User-Agent strings; the
//     report reads the site's own per-visit records and, separately, the hourly counts it sends out;
//   - a fixed set of records for what the Gate classifies with signatures (VERIFIED, SPOOFED,
//     REVOKED, UNVERIFIED) and for odd rows (a declared write with no known name, an "(other)" row).
// A fake is a write (POST, PUT, PATCH, DELETE) under a crawler's or a search bot's name, unsigned.
// Not fakes: the same crawlers reading, a person's fetcher (ChatGPT-User, Perplexity-User) writing,
// signed agents writing, unnamed automation writing, people. The judge is tried first on planted
// rules: one that flags nothing, one that flags every declared write, one that flags a name whatever
// it does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate, generateSiteKey } from "@ludion/gate-core";
import { WRITE_METHODS } from "@ludion/gate-core/route";
import { parseEvents, summarize, isSuspectedFake, renderText, renderHtml, LANGS } from "../src/index.mjs";

const SITE_ID = "site-one5", ORIGIN = "https://shop.example";
const T0 = Date.UTC(2026, 8, 29, 9);
const UA = {
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  Googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  "Perplexity-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
  curl: "curl/8.7.1",
  person: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

// Through the Gate: [User-Agent, method, path, how many, fake?]
const REQUESTS = [
  ["GPTBot", "POST", "/contact", 5, true],
  ["GPTBot", "GET", "/products/1", 20, false],
  ["GPTBot", "HEAD", "/", 2, false],
  ["ClaudeBot", "PUT", "/api/cart", 2, true],
  ["ClaudeBot", "GET", "/blog/hello", 4, false],
  ["Googlebot", "DELETE", "/account/settings", 1, true],
  ["Googlebot", "GET", "/", 6, false],
  ["ChatGPT-User", "POST", "/checkout", 3, false],
  ["Perplexity-User", "POST", "/contact", 2, false],
  ["curl", "POST", "/login", 6, false],
  ["person", "POST", "/contact", 4, false], // a person: never recorded as automation
];
const TRUTH = [{ token: "GPTBot", writes: 5 }, { token: "ClaudeBot", writes: 2 }, { token: "Googlebot", writes: 1 }];

// Fixed records for what needs a signature, and odd rows: [class, method, route, operator, how many, fake?]
const FIXED = [
  ["VERIFIED", "POST", "/checkout", "dvr-k7q2m6x4pcab3cde", 4, false],
  ["VERIFIED", "POST", "/contact", "chatgpt.com", 2, false],
  ["SPOOFED", "POST", "/login", "none", 3, false],
  ["REVOKED", "POST", "/checkout", "dvr-q9w8e7r6t5y4u3i2", 1, false],
  ["UNVERIFIED", "PATCH", "/account/settings", "agent.example", 2, false],
  ["DECLARED", "POST", "/contact", "none", 3, false], // a declared write with no name the ledger knows
  ["SUSPECTED", "DELETE", "/api/cart", "none", 2, false],
];

async function throughTheGate() {
  const recs = [], batches = [];
  let t = T0;
  const gate = await createGate({ siteId: SITE_ID, siteKey: (await generateSiteKey()).privateJwk, now: () => t,
    records: { put: (r) => { recs.push(r); } }, sink: (b) => { batches.push(b); } });
  const labels = [];
  for (const [who, method, path, n, fake] of REQUESTS) {
    for (let i = 0; i < n; i++) {
      t += 1000;
      const before = recs.length;
      await gate.inspect({ kind: "request", method, targetUri: `${ORIGIN}${path}`, fields: [{ name: "user-agent", value: UA[who] }] });
      if (recs.length > before) labels.push({ who, fake });
    }
  }
  gate.flush({ all: true });
  await new Promise((r) => setImmediate(r));
  return { recs, batches, labels };
}

function fixedRecords() {
  const out = [];
  let i = 0;
  for (const [cls, method, route, operator, n, fake] of FIXED) {
    for (let k = 0; k < n; k++) out.push({ rec: { v: 0, rid: `rcp-f${i}`, site: SITE_ID, ts: T0 / 1000 + 7200 + i++, method, access: method === "GET" ? "read" : "write", route, class: cls, decision: "allow",
      error: null, pressure: 0, diver: cls === "VERIFIED" || cls === "REVOKED" ? (operator.startsWith("dvr-") ? operator : `https://${operator}`) : null, operator, country: null, ip_h: null }, fake });
  }
  return out;
}

/** Visits a rule gets wrong: flagged but not a fake, or a fake not flagged. */
export function misjudged(rule, labelled) {
  const out = [];
  for (const { event, fake, who } of labelled) {
    const flagged = !!rule(event);
    if (flagged && !fake) out.push(`flagged a visit that is not a fake: ${who} ${event.class} ${event.access} ${event.route}`);
    if (!flagged && fake) out.push(`missed a fake: ${who} ${event.access} ${event.route}`);
  }
  return out;
}

async function world() {
  const gate = await throughTheGate();
  const fixed = fixedRecords();
  const all = [...gate.recs, ...fixed.map((f) => f.rec)];
  const labelled = [
    ...gate.recs.map((r, i) => ({ record: r, fake: gate.labels[i].fake, who: gate.labels[i].who })),
    ...fixed.map((f) => ({ record: f.rec, fake: f.fake, who: f.rec.operator })),
  ].map((x) => ({ ...x, event: parseEvents(JSON.stringify(x.record)).events[0] }));
  return { gate, fixed, all, labelled };
}

test("ONE-5: the judge catches a rule that flags nothing, every declared write, or a crawler's name whatever it does (planted)", async () => {
  const w = await world();
  assert.deepEqual(misjudged(isSuspectedFake, w.labelled), [], "the report's rule");
  const planted = [
    ["flags nothing", () => false, /missed a fake/],
    ["flags every declared write", (e) => e.class === "DECLARED" && e.access === "write", /not a fake: (ChatGPT-User|Perplexity-User|none)/],
    ["flags a crawler's name, reads too", (e) => e.class === "DECLARED" && ["GPTBot", "ClaudeBot", "Googlebot"].includes(e.operator), /not a fake: (GPTBot|ClaudeBot|Googlebot) DECLARED read/],
    ["flags any write under any name", (e) => e.access === "write" && e.class !== "SUSPECTED", /not a fake: .*VERIFIED write/],
  ];
  for (const [name, rule, want] of planted) {
    const m = misjudged(rule, w.labelled);
    assert.ok(m.some((p) => want.test(p)), `${name} was not caught: ${m.slice(0, 3).join("; ")}`);
  }
});

test("ONE-5: writes under a crawler's name are reported as suspected fakes, 0 misjudged, from records and from hourly counts, ja and en", async () => {
  const w = await world();
  assert.ok(w.gate.labels.every((l) => l.who !== "person"), "a person is never recorded");
  assert.equal(w.gate.recs.length, REQUESTS.filter(([who]) => who !== "person").reduce((n, r) => n + r[3], 0), "every automated request is recorded");
  const classes = new Set(w.gate.recs.map((r) => `${r.class}:${r.operator}`));
  for (const want of ["DECLARED:GPTBot", "DECLARED:ClaudeBot", "DECLARED:Googlebot", "DECLARED:ChatGPT-User", "DECLARED:Perplexity-User", "SUSPECTED:none"]) assert.ok(classes.has(want), `the Gate recorded ${want}`);
  assert.deepEqual(misjudged(isSuspectedFake, w.labelled), []);
  const opts = { site: SITE_ID, date: "2026-09-29", tz: "UTC" };
  const fromRecords = summarize(parseEvents(w.all.map((r) => JSON.stringify(r)).join("\n")).events, opts);
  const fromHours = summarize(parseEvents([...w.gate.batches, ...w.fixed.map((f) => hourlyOf(f.rec))].map((x) => JSON.stringify(x)).join("\n")).events, opts);
  assert.ok(w.gate.batches.length >= 1);
  for (const [input, s] of [["records", fromRecords], ["hourly", fromHours]]) {
    assert.deepEqual(s.suspected_fakes, TRUTH, `${input}: the suspected fakes`);
    for (const lang of LANGS) {
      const html = renderHtml(s, lang), text = renderText(s, lang);
      const sec = /<td data-section="fakes"[\s\S]*?<\/td><\/tr>\n<tr><td data-section="critical"/.exec(html)?.[0] ?? "";
      TRUTH.forEach((f, i) => {
        assert.match(sec, new RegExp(`data-name="suspected_fakes\\.${i}\\.token"[^>]*>${f.token}<`), `${input} ${lang}: ${f.token} named`);
        assert.match(sec, new RegExp(`data-metric="suspected_fakes\\.${i}\\.writes"[^>]*>${f.writes}<`), `${input} ${lang}: ${f.token}'s writes`);
        assert.match(text, new RegExp(`${f.token}　${f.writes} / `), `${input} ${lang}: ${f.token} in the text`);
      });
      assert.match(text, lang === "ja" ? /偽物の疑い/ : /Suspected fakes/);
    }
  }
  const fakes = TRUTH.reduce((n, f) => n + f.writes, 0);
  console.log(`ONE-5: ${w.labelled.length} labelled visits (${w.gate.recs.length} through the Gate, ${w.fixed.length} fixed): ${fakes} suspected fakes (${TRUTH.map((f) => `${f.token} ${f.writes}`).join(", ")}), 0 misjudged, from records and from hourly counts; crawler reads, people's fetchers, signed agents and unnamed automation not flagged; 4 planted rules caught`);
});

/** A fixed record as one hourly batch (what the Gate would send for it). */
function hourlyOf(r) {
  return { v: 0, kind: "ludion.hourly", site: r.site, hour: r.ts - (r.ts % 3600), rows: [{ route: r.route, access: r.access, class: r.class, decision: r.decision, operator: r.operator, count: 1 }] };
}
