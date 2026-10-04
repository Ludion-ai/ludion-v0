// From metadata events to the numbers of the daily report (spec §11.8).
//
// Input is what the Gate's sink emits (gate-core metadataEvent, spec §11.7). Only a fixed set of
// fields is ever read — site, ts, access, route, class, decision, pressure, diver — and nothing
// else is carried forward, so a field an old or broken Gate added (a raw IP, a cookie, a query)
// cannot reach the report. Routes are shown only as strict templates, agents only by a name
// that is not an address.
//
// Whether a visit wrote is the Gate's call, made where the site's config is (a route marked
// "writes": false is a read): the record and the hourly count carry it as `access`, "read" or
// "write". The report goes by that alone — never the method, never the site's config — so a
// read-only POST is never counted as a write here (spec §12.5).
import { decide, AUTOMATION, isReadOnlyAgent, ACCESS } from "@ludion/gate-core";
import { routeKind, pathOf, publicTemplateSegment, ROUTE_KINDS, CRITICAL_KINDS } from "@ludion/gate-core/route";
import { dayWindow, addDays } from "./window.mjs";

export const REPORT_CLASSES = ["VERIFIED", "UNVERIFIED", "SPOOFED", "REVOKED", "DECLARED", "SUSPECTED"];
export const TOP_AGENTS = 5, TOP_ROUTES = 8, TOP_DID = 3, TOP_FAKES = 5;

// The headline's three rows (spec §12.3): who proved its name, who only claimed one, who gave none.
// Proved = a valid signature (VERIFIED, and REVOKED: the signature was good, the identity revoked).
// Claimed = a name without proof (a User-Agent token, a signature that failed or could not be checked).
export const GROUPS = ["named", "claimed", "unnamed"];
export const GROUP_OF = { VERIFIED: "named", REVOKED: "named", DECLARED: "claimed", UNVERIFIED: "claimed", SPOOFED: "claimed", SUSPECTED: "unnamed" };
export const UNNAMED = "(unnamed)";
const DECISIONS = new Set(["allow", "friction", "deny"]);
const PLACEHOLDER = /^:(?:id|uuid|email|handle|hex|token|param)$/;
const DIVER_ID = /^dvr-[a-z0-9]{8,40}$/;

/** One parsed event with only the fields the report may use, or null when it is not one. */
export function readEvent(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  if (typeof e.site !== "string" || typeof e.ts !== "number" || !Number.isFinite(e.ts)) return null;
  if (!AUTOMATION.has(e.class) || !DECISIONS.has(e.decision)) return null;
  if (!Number.isInteger(e.pressure) || e.pressure < 0 || e.pressure > 3) return null;
  if (!ACCESS.includes(e.access)) return null;
  return {
    site: e.site, ts: e.ts * 1000,
    access: e.access,
    route: typeof e.route === "string" ? e.route : "",
    class: e.class, decision: e.decision, pressure: e.pressure,
    diver: typeof e.diver === "string" ? e.diver : null,
    operator: operatorField(e.operator),
    ...saidFields(e),
  };
}

/**
 * What a per-visit record says the agent declared, set against what it did (gate-core purpose.mjs):
 * only a contradiction of a SIGNED declaration, and its sentence as written (unchecked). An hourly
 * count never carries any of it.
 */
function saidFields(e) {
  if (e.verdict !== "contradiction" || e.said_by !== "signature" || e.said !== "read") return {};
  const note = e.purpose?.signed && typeof e.purpose.note === "string" && [...e.purpose.note].length <= 140 ? e.purpose.note : null;
  return { contradiction: true, note };
}

/**
 * A sentence an agent wrote, made safe to show (PUR-5): nothing in it can become a link in a mail
 * client or a browser — schemes, host names and addresses are defanged — and control characters go.
 * The renderers escape it as any other text.
 */
export function defang(s) {
  return String(s)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/\b([a-z][a-z0-9+.-]*):\/\//gi, (m, scheme) => `${scheme.toLowerCase().replace(/^http/, "hxxp")}[:]//`)
    .replace(/\b(javascript|vbscript|data|mailto|tel|sms|file):/gi, "$1[:]")
    .replace(/\b(www)\./gi, "$1[.]")
    // a dot between the labels of something shaped like a host name (example.com, shop.example.co.jp)
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi, (host) => host.replace(/\./g, "[.]"))
    .replace(/@/g, "[at]");
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** An operator as a record or a count carries it, or null for none (and for anything that is not one). */
const operatorField = (o) => (typeof o === "string" && o !== "none" && TOKEN.test(o) ? o : null);

const HOURLY = "ludion.hourly";

/**
 * An hourly batch (what a Gate sends out, ADR-038) as weighted events: one per row, `n` its count,
 * at the hour's start, with no pressure (a batch does not carry it). Null when it is not a batch.
 */
export function readBatch(b) {
  if (!b || typeof b !== "object" || b.kind !== HOURLY) return null;
  if (typeof b.site !== "string" || !Number.isInteger(b.hour) || b.hour % 3600 !== 0 || !Array.isArray(b.rows)) return null;
  const out = [];
  for (const r of b.rows) {
    if (!r || !AUTOMATION.has(r.class) || !DECISIONS.has(r.decision) || !Number.isInteger(r.count) || r.count < 1) return null;
    if (!ACCESS.includes(r.access)) return null;
    out.push({
      site: b.site, ts: b.hour * 1000,
      access: r.access,
      route: typeof r.route === "string" ? r.route : "",
      class: r.class, decision: r.decision, pressure: null,
      diver: typeof r.operator === "string" && r.operator !== "none" ? r.operator : null,
      operator: operatorField(r.operator),
      n: r.count,
    });
  }
  return out;
}

/**
 * NDJSON (one event per line; a JSON array is accepted too): the site's per-visit records, or the
 * hourly batches a Gate sends out (one line per batch). Blank lines are ignored; every other line
 * that is neither is counted as skipped, never as traffic.
 * @returns {{ events: object[], skipped: number }}
 */
export function parseEvents(text) {
  const events = [];
  let skipped = 0;
  const take = (e) => {
    const rows = readBatch(e);
    if (rows) { events.push(...rows); return; }
    const ev = readEvent(e);
    if (ev) events.push(ev); else skipped++;
  };
  const t = text.replace(/^﻿/, "");
  if (/^\s*\[/.test(t)) {
    let arr;
    try { arr = JSON.parse(t); } catch { arr = null; }
    if (Array.isArray(arr)) {
      for (const e of arr) take(e);
      return { events, skipped };
    }
  }
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { skipped++; continue; }
    take(e);
  }
  return { events, skipped };
}

/** A route as the report shows it: template placeholders kept, every other segment strict. */
export function displayRoute(route) {
  const p = pathOf(route);
  if (p == null || p === "") return null;
  return p.split("/").map((s) => (PLACEHOLDER.test(s) ? s : publicTemplateSegment(s))).join("/");
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** A verified agent's name: its Diver id, or the host of its identifier URL — never an address. */
export function agentName(diver) {
  if (typeof diver !== "string") return UNNAMED;
  if (DIVER_ID.test(diver)) return diver;
  // An hourly count names a non-Ludion signer by the bare host of its identifier (ADR-038).
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(diver) && !IPV4.test(diver)) return diver.toLowerCase();
  let u;
  try { u = new URL(diver); } catch { return UNNAMED; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return UNNAMED;
  const h = u.hostname.toLowerCase();
  if (!h || h.includes(":") || h.startsWith("[") || IPV4.test(h) || !/^[a-z0-9.-]+$/.test(h) || !h.includes(".")) return UNNAMED;
  return h;
}

const byCount = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);

/**
 * A suspected fake (spec §12.5 rule 2, ONE-5): a write (as the Gate counted it) by something that
 * only claimed, in its User-Agent and without a signature (DECLARED), the name of an agent that only
 * reads — a crawler or a search indexer (gate-core isReadOnlyAgent). The real one does not submit.
 * A person's fetcher (ChatGPT-User and the like) may submit; a signed agent proved its name.
 */
export const isSuspectedFake = (e) => e.class === "DECLARED" && typeof e.operator === "string" && e.access === "write" && isReadOnlyAgent(e.operator);

/** A critical touch (spec §11.3): a critical kind of route, or any write as the Gate counted it. */
const isCriticalVisit = (e, kind) => CRITICAL_KINDS.has(kind) || e.access === "write";

/** The numbers for one site and one window. */
export function count(events) {
  const classes = Object.fromEntries(REPORT_CLASSES.map((c) => [c, 0]));
  const decisions = { allow: 0, friction: 0, deny: 0 };
  const kinds = {}, agents = new Map(), routes = new Map();
  const critical = { unverified: 0, allowed: 0, friction: 0, denied: 0 };
  const pressure1 = { friction: 0, exempt: 0, applies: false };
  const groups = Object.fromEntries(GROUPS.map((g) => [g, { count: 0, kinds: {} }]));
  const fakes = new Map(), fakesAllowed = new Map(), wall = {}, said = new Map();
  let total = 0, pressureKnown = false;
  for (const e of events) {
    const n = e.n ?? 1; // an hourly row stands for n visits; a per-visit record for one
    total += n;
    classes[e.class] += n;
    decisions[e.decision] += n;
    const kind = routeKind(null, e.route);
    const g = groups[GROUP_OF[e.class]];
    g.count += n;
    g.kinds[kind] = (g.kinds[kind] ?? 0) + n;
    if (e.contradiction) {
      const name = agentName(e.diver), key = JSON.stringify([name, e.note]);
      const x = said.get(key) ?? { agent: name, note: e.note, writes: 0, kinds: {} };
      x.writes += n; x.kinds[kind] = (x.kinds[kind] ?? 0) + n;
      said.set(key, x);
    }
    if (isSuspectedFake(e)) {
      fakes.set(e.operator, (fakes.get(e.operator) ?? 0) + n);
      if (e.decision === "allow") fakesAllowed.set(e.operator, (fakesAllowed.get(e.operator) ?? 0) + n);
    }
    // What a wall (Pressure 1) would meet: unproven automation let through on a critical route.
    if (e.class !== "VERIFIED" && CRITICAL_KINDS.has(kind) && e.decision === "allow") wall[kind] = (wall[kind] ?? 0) + n;
    const k = (kinds[kind] ??= { automation: 0, verified: 0, denied: 0 });
    k.automation += n;
    if (e.class === "VERIFIED") { k.verified += n; const a = agentName(e.diver); agents.set(a, (agents.get(a) ?? 0) + n); }
    if (e.decision === "deny") k.denied += n;
    if (e.class !== "VERIFIED" && kind !== "malformed" && isCriticalVisit(e, kind)) {
      critical.unverified += n;
      critical[{ allow: "allowed", friction: "friction", deny: "denied" }[e.decision]] += n;
      const r = displayRoute(e.route);
      if (r) routes.set(r, (routes.get(r) ?? 0) + n);
    }
    // What Pressure 1 would do to what is at Pressure 0 today: the Gate's own rule (spec §11.3).
    // Only per-visit records carry the pressure; hourly counts do not (ADR-038).
    if (e.pressure != null) pressureKnown = true;
    if (e.pressure === 0) {
      pressure1.applies = true;
      const d = decide({ class: e.class }, { pressure: 1 });
      if (d.action === "friction") pressure1.friction += n;
      else if (d.exempt) pressure1.exempt += n;
    }
  }
  if (!pressureKnown && events.length) pressure1.unknown = true;
  const kindOrder = (a, b) => b[1] - a[1] || ROUTE_KINDS.indexOf(a[0]) - ROUTE_KINDS.indexOf(b[0]);
  const suspectedFakes = [...fakes].sort(byCount).slice(0, TOP_FAKES).map(([token, writes]) => ({ token, writes }));
  return {
    headline: { named_pct: total ? Math.round((100 * groups.named.count) / total) : null },
    groups: Object.fromEntries(GROUPS.map((k) => [k, {
      count: groups[k].count,
      did: Object.entries(groups[k].kinds).sort(kindOrder).slice(0, TOP_DID).map(([kind]) => kind),
    }])),
    decision: mainDecision(wall, fakesAllowed),
    suspected_fakes: suspectedFakes,
    // Signed "read", then wrote (spec §11.7, §12.3): the agent's own words beside what it did.
    said_vs_did: [...said.values()].sort((a, b) => b.writes - a.writes || (a.agent < b.agent ? -1 : 1)).slice(0, TOP_FAKES)
      .map((x) => ({ agent: x.agent, note: x.note == null ? null : defang(x.note), writes: x.writes, did: Object.entries(x.kinds).sort(kindOrder).slice(0, TOP_DID).map(([k]) => k) })),
    events: total, classes, decisions,
    verified_actions: classes.VERIFIED,
    verified_agents: [...agents.keys()].filter((a) => a !== UNNAMED).length,
    critical,
    kinds: Object.fromEntries(ROUTE_KINDS.filter((k) => kinds[k]).map((k) => [k, kinds[k]])),
    top_agents: [...agents].sort(byCount).slice(0, TOP_AGENTS).map(([agent, actions]) => ({ agent, actions })),
    top_critical_routes: [...routes].sort(byCount).slice(0, TOP_ROUTES).map(([route, n]) => ({ route, count: n })),
    pressure1,
  };
}

/**
 * The report's one decision (spec §12.3), by a fixed rule, in this order:
 *   1. "wall": unproven automation was let through on a critical route (checkout, login, sign-up,
 *      account) → put a wall on the kind with the most of it (ties: checkout, login, signup, account);
 *   2. "wall_fakes": writes under a crawler's name were let through → a wall for the token with the
 *      most of them (ties: by token);
 *   3. "none": nothing to decide.
 * It counts only what was allowed: what already met friction or was refused is decided.
 */
export function mainDecision(wall, fakesAllowed) {
  const kinds = [...CRITICAL_KINDS].filter((k) => wall[k] > 0).sort((a, b) => wall[b] - wall[a] || ROUTE_KINDS.indexOf(a) - ROUTE_KINDS.indexOf(b));
  if (kinds.length) return { action: "wall", kind: kinds[0] };
  const fakes = [...fakesAllowed].filter(([, n]) => n > 0).sort(byCount);
  if (fakes.length) return { action: "wall_fakes", token: fakes[0][0] };
  return { action: "none" };
}

/** Sites present in the events. */
export const sitesOf = (events) => [...new Set(events.map((e) => e.site))].sort();

/**
 * The daily report's numbers.
 * @param {object[]} events from parseEvents
 * @param {{ site: string, date: string, tz: string, skipped?: number }} opts
 */
export function summarize(events, { site, date, tz, skipped = 0 }) {
  const win = dayWindow(date, tz), prevWin = dayWindow(addDays(date, -1), tz);
  const mine = events.filter((e) => e.site === site);
  const cur = count(mine.filter((e) => e.ts >= win.start && e.ts < win.end));
  const prevEvents = mine.filter((e) => e.ts >= prevWin.start && e.ts < prevWin.end);
  const prev = prevEvents.length ? count(prevEvents) : null;
  const pick = (c) => ({ events: c.events, verified_actions: c.verified_actions, critical_unverified: c.critical.unverified, spoofed: c.classes.SPOOFED });
  const pv = prev && pick(prev), cv = pick(cur);
  return {
    report: "ludion daily report", v: 0, site, date, tz,
    window: { start: new Date(win.start).toISOString(), end: new Date(win.end).toISOString() },
    ...cur,
    previous: pv,
    delta: pv && Object.fromEntries(Object.keys(cv).map((k) => [k, cv[k] - pv[k]])),
    skipped,
  };
}
