// ONE-2 (+): the morning report has one headline number and one main decision (spec §12.3, §9.3).
//
// The headline is the share of automation that proved its name with a signature — a ratio, not a
// count, so it does not read as a spam tally — and under it the three groups (named, claimed a name,
// unnamed). Then one decision, by a fixed rule (summarize.mjs mainDecision). Four fixed days, each
// with its truth written by hand; each is reported from the site's per-visit records and from the
// hourly counts a Gate sends out (ADR-038), in Japanese and English, as text and as HTML. The judge
// is tried first on planted reports: two numbers in the headline, no decision, two decisions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHourly } from "@ludion/gate-core";
import { parseEvents, summarize, renderText, renderHtml, LANGS } from "../src/index.mjs";

const SITE = "site-one2", DATE = "2026-09-29", TZ = "UTC";
const T0 = Date.UTC(2026, 8, 29, 9) / 1000;

// A day as visits: [class, method, path, decision, operator, how many]. Truth by hand.
const DAYS = [
  { id: "spec §12.3's example", truth: { pct: 18, decision: { action: "wall", kind: "login" } }, visits: [
    ["VERIFIED", "POST", "/checkout", "allow", "dvr-k7q2m6x4pcab3cde", 2],
    ["VERIFIED", "POST", "/contact", "allow", "dvr-k7q2m6x4pcab3cde", 1],
    ["DECLARED", "POST", "/contact", "allow", "GPTBot", 5],
    ["SUSPECTED", "POST", "/login", "allow", "none", 6],
    ["SUSPECTED", "POST", "/contact", "allow", "none", 3],
  ] }, // 3 of 17 named = 17.6% → 18; unnamed logins let through → a wall on login
  { id: "a crawler's name on a form", truth: { pct: 11, decision: { action: "wall_fakes", token: "ClaudeBot" } }, visits: [
    ["VERIFIED", "GET", "/products/1", "allow", "chatgpt.com", 2],
    ["DECLARED", "POST", "/contact", "allow", "ClaudeBot", 4],
    ["DECLARED", "GET", "/products/2", "allow", "GPTBot", 10],
    ["SUSPECTED", "POST", "/login", "friction", "none", 3],
  ] }, // 2 of 19 = 10.5% → 11; the login already meets friction; ClaudeBot's writes were let through
  { id: "nothing left to decide", truth: { pct: 56, decision: { action: "none" } }, visits: [
    ["VERIFIED", "POST", "/checkout", "allow", "dvr-k7q2m6x4pcab3cde", 5],
    ["SUSPECTED", "POST", "/login", "deny", "none", 2],
    ["SPOOFED", "POST", "/login", "friction", "none", 2],
  ] }, // 5 of 9 = 55.6% → 56; what reached a critical route already met friction or was refused
  { id: "two walls to choose from", truth: { pct: 40, decision: { action: "wall", kind: "checkout" } }, visits: [
    ["VERIFIED", "GET", "/products/3", "allow", "dvr-k7q2m6x4pcab3cde", 4],
    ["SUSPECTED", "POST", "/login", "allow", "none", 2],
    ["UNVERIFIED", "POST", "/checkout", "allow", "agent.example", 3],
    ["DECLARED", "GET", "/cart", "allow", "GPTBot", 1],
  ] }, // 4 of 10 = 40%; unproven automation let through: 4 on checkout, 2 on login → checkout
  { id: "a day with no automation", truth: { events: 0, decision: { action: "none" } }, visits: [] },
];

function records(day) {
  const out = [];
  let i = 0;
  for (const [cls, method, path, decision, operator, n] of day.visits) {
    for (let k = 0; k < n; k++) {
      out.push({ v: 0, rid: `rcp-${i}`, site: SITE, ts: T0 + 60 * i++, method, route: path, class: cls, decision, error: null, pressure: 0,
        diver: cls === "VERIFIED" ? (operator.startsWith("dvr-") ? operator : `https://${operator}`) : null, operator, country: null, ip_h: null });
    }
  }
  return out;
}

function hourly(recs) {
  const batches = [];
  const hr = createHourly({ siteId: SITE, now: () => 0, emit: (b) => batches.push(b) });
  for (const r of recs) hr.add(r, r.operator);
  hr.flushAll();
  return batches;
}

const report = (lines) => summarize(parseEvents(lines.map((x) => JSON.stringify(x)).join("\n")).events, { site: SITE, date: DATE, tz: TZ });
const numbers = (s) => [...s.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, "")));
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");

/** What is wrong with a report's headline and decision, read from its text and HTML alone. */
export function headlineProblems({ text, html }) {
  const out = [];
  const lines = text.split("\n");
  const head = lines[3] ?? ""; // title, meta, a blank line, then the headline
  if (numbers(head).length !== 1) out.push(`text: the headline line has ${numbers(head).length} numbers: ${head}`);
  const decisions = lines.filter((l) => l.startsWith("→ "));
  if (decisions.length !== 1) out.push(`text: ${decisions.length} decision lines`);
  else if (decisions[0].length < 4) out.push("text: an empty decision");
  const rows = [...html.matchAll(/<tr data-headline="1">([\s\S]*?)<\/tr>/g)];
  if (rows.length !== 1) out.push(`html: ${rows.length} headline rows`);
  else {
    const metrics = [...rows[0][1].matchAll(/data-metric="/g)].length;
    const inRow = numbers(decode(rows[0][1].replace(/<[^>]*>/g, " ")));
    if (metrics !== 1 || inRow.length !== 1) out.push(`html: the headline row has ${metrics} metrics and ${inRow.length} numbers`);
    else if (inRow[0] !== numbers(head)[0]) out.push(`html and text disagree: ${inRow[0]} vs ${numbers(head)[0]}`);
  }
  const d = [...html.matchAll(/data-decision="([^"]+)"/g)];
  if (d.length !== 1) out.push(`html: ${d.length} decisions`);
  return out;
}

test("ONE-2: the judge catches two numbers in the headline, no decision, two decisions (planted)", () => {
  const s = report(records(DAYS[0]));
  const good = { text: renderText(s, "en"), html: renderHtml(s, "en") };
  assert.deepEqual(headlineProblems(good), []);
  const planted = [
    ["two numbers in the headline", { ...good, text: good.text.replace(/^(.*% named.*)$/m, "$1 (17 requests)") }, /headline line has 2/],
    ["no decision", { text: good.text.replace(/^→ .*$/m, ""), html: good.html.replace(/data-decision="[^"]+"/, "") }, /0 decision/],
    ["two decisions", { text: good.text.replace(/^(→ .*)$/m, "$1\n→ Also stop GPTBot."), html: good.html }, /2 decision lines/],
    ["a second metric in the headline row", { ...good, html: good.html.replace(/(<tr data-headline="1">)/, '$1<td data-metric="events" style="x">17</td>') }, /2 metrics/],
  ];
  for (const [name, r, want] of planted) assert.ok(headlineProblems(r).some((p) => want.test(p)), `${name}: ${headlineProblems(r).join("; ")}`);
});

test("ONE-2: one headline number and one decision, from per-visit records and from hourly counts, ja and en, text and HTML", () => {
  const seen = [];
  for (const day of DAYS) {
    const recs = records(day);
    const fromRecords = report(recs), fromHours = report(hourly(recs));
    for (const k of ["headline", "groups", "decision", "suspected_fakes", "events"]) assert.deepEqual(fromHours[k], fromRecords[k], `${day.id}: ${k} differs by input`);
    for (const [input, s] of [["records", fromRecords], ["hourly", fromHours]]) {
      assert.deepEqual(s.decision, day.truth.decision, `${day.id} (${input}): the decision`);
      if ("pct" in day.truth) assert.equal(s.headline.named_pct, day.truth.pct, `${day.id} (${input}): the share`);
      else { assert.equal(s.headline.named_pct, null); assert.equal(s.events, day.truth.events); }
      for (const lang of LANGS) {
        const text = renderText(s, lang), html = renderHtml(s, lang);
        assert.deepEqual(headlineProblems({ text, html }), [], `${day.id} (${input}, ${lang})`);
        assert.equal(numbers(text.split("\n")[3])[0], day.truth.pct ?? day.truth.events, `${day.id} (${input}, ${lang}): the headline number`);
        assert.match(html, new RegExp(`data-decision="${day.truth.decision.action}"`), `${day.id} (${input}, ${lang}): the decision shown`);
      }
    }
    seen.push(`${"pct" in day.truth ? `${day.truth.pct}%` : "0 automation"} → ${day.truth.decision.action}${day.truth.decision.kind ? ` ${day.truth.decision.kind}` : ""}${day.truth.decision.token ? ` ${day.truth.decision.token}` : ""}`);
  }
  console.log(`ONE-2: ${DAYS.length} days × 2 inputs × ${LANGS.join("/")} × text/HTML: one headline number and one decision each (${seen.join("; ")}); 4 planted reports caught`);
});
