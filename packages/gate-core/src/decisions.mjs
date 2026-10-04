// The site's own decisions about who may do what here (spec §12.4, ADR-032): let through, put up a
// wall, stop. One line each in the site's config, undone by deleting it; each may be held to every
// write or to one route, and may end at a time. Ludion's servers have no say: nothing here is fetched,
// and nothing a Registry, a key directory or a report endpoint sends can add, change or lengthen one
// (BLK-1). Humans are never matched: a decision only ever touches automation.
//
//   "decisions": [
//     { "who": "dvr-k7q2m6x4pcab3cde", "action": "block", "scope": "/checkout/**", "until": "2026-10-11T00:00:00Z" },
//     { "who": "GPTBot", "action": "block", "scope": "writes" },
//     { "who": "unnamed", "action": "wall", "scope": "/login" },
//     { "who": "chatgpt.com", "action": "allow" }
//   ]
//
// who:    a Diver id (dvr-…), a signer's host (chatgpt.com: a signed agent outside Ludion), a declared
//         token (GPTBot: a name in the User-Agent, unsigned), or "unnamed" (automation that names no one).
// action: "allow" (let through: a signed identity only), "wall" (the site's existing friction:
//         unnamed automation only), "block" (403 blocked_by_site). The table of spec §12.4.
// scope:  "writes" (every write: POST, PUT, PATCH, DELETE, except routes marked "writes": false) or a
//         route ("/checkout/**"). Absent: everything.
// until:  a date-time (RFC 3339). Absent: until the line is deleted.
import { compileRoute } from "./classify.mjs";
import { routeCandidates } from "./route.mjs";
import { operatorOf } from "./hourly.mjs";

export const DECISION_ACTIONS = Object.freeze(["allow", "wall", "block"]);
export const UNNAMED = "unnamed";
const KEYS = new Set(["who", "action", "scope", "until"]);
const DIVER = /^dvr-[a-z2-7]{16}$/;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
// Strictest first: a block beats a wall beats a let-through (as overlapping routes do, PRS-4).
const RANK = { allow: 1, wall: 2, block: 3 };

const fail = (msg) => { throw new TypeError(`ludion config: ${msg}`); };

/** What kind of identity a `who` names. */
export function whoKind(who) {
  if (who === UNNAMED) return "unnamed";
  if (DIVER.test(who)) return "diver";
  if (HOST.test(who)) return "signer";
  if (TOKEN.test(who)) return "token";
  return null;
}

/**
 * Validate the site's decisions (the config's `decisions`). Throws a TypeError naming the line.
 * @returns {{ who: string, kind: string, action: string, writes: boolean, route: {match: string, re: RegExp}|null, until: number|null, line: number }[]}
 */
export function parseDecisions(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) fail("decisions must be an array of { who, action, scope?, until? }");
  return list.map((d, i) => {
    const at = `decisions[${i}]`;
    if (d == null || typeof d !== "object" || Array.isArray(d)) fail(`${at} must be an object`);
    for (const k of Object.keys(d)) if (!KEYS.has(k)) fail(`unknown key ${JSON.stringify(k)} in ${at} (known: ${[...KEYS].join(", ")})`);
    // Diver ids and hosts are case-insensitive; a token keeps its spelling (matched without case).
    const who = typeof d.who !== "string" ? d.who : ["diver", "signer"].includes(whoKind(d.who.toLowerCase())) ? d.who.toLowerCase() : d.who;
    const kind = typeof who === "string" ? whoKind(who) : null;
    if (!kind) fail(`${at}.who must be a Diver id (dvr-…), a signer's host (chatgpt.com), a declared token (GPTBot) or "unnamed" (got ${JSON.stringify(d.who)})`);
    if (!DECISION_ACTIONS.includes(d.action)) fail(`${at}.action must be one of ${DECISION_ACTIONS.join(", ")} (got ${JSON.stringify(d.action)})`);
    if (d.action === "allow" && kind !== "diver" && kind !== "signer") fail(`${at}: "allow" is for a signed identity (a Diver id or a signer's host); ${kind === "token" ? "a name in a User-Agent" : "unnamed automation"} proves nothing`);
    if (d.action === "wall" && kind !== "unnamed") fail(`${at}: "wall" is for unnamed automation ("who": "unnamed"); a named one is let through or blocked`);
    let writes = false, route = null;
    if (d.scope != null) {
      if (d.scope === "writes") writes = true;
      else if (typeof d.scope === "string" && d.scope.startsWith("/")) route = { match: d.scope, re: compileRoute(d.scope) };
      else fail(`${at}.scope must be "writes" or a route starting with "/" (got ${JSON.stringify(d.scope)})`);
    }
    let until = null;
    if (d.until != null) {
      if (typeof d.until !== "string" || !RFC3339.test(d.until) || !Number.isFinite(Date.parse(d.until))) {
        fail(`${at}.until must be a date and time, e.g. "2026-10-11T00:00:00Z" (got ${JSON.stringify(d.until)}): a duration such as "7d" has no start in a file`);
      }
      until = Date.parse(d.until);
    }
    return { who, kind, action: d.action, writes, route, until, line: i };
  });
}

/** Does the decision name this visitor? Humans (UNKNOWN) and Gate faults never match. */
function names(d, cls, operator) {
  if (cls.class === "UNKNOWN" || cls.signal === "gate_error") return false;
  if (d.kind === "unnamed") return operator === "none";
  if (d.action === "allow" && cls.class !== "VERIFIED") return false; // only a proven identity is let through
  if (d.kind === "token") return cls.class === "DECLARED" && operator.toLowerCase() === d.who.toLowerCase();
  return operator === d.who;
}

/**
 * The site's decisions, ready to match.
 * @param {unknown} list   the config's `decisions` (validated here; parseDecisions)
 * @param {{ now: () => number }} o
 */
export function createDecisions(list, { now }) {
  const ds = parseDecisions(list);
  return {
    size: ds.length,
    /**
     * The strictest decision in force that names this visit, or null.
     * @param {object} cls  the classification
     * @param {{ path: string, write: boolean }} visit  write: a write method on a route not marked read-only
     */
    match(cls, { path, write }) {
      if (!ds.length) return null;
      const t = now();
      const op = operatorOf(cls);
      let best = null;
      for (const d of ds) {
        if (d.until != null && t >= d.until) continue;
        if (!names(d, cls, op)) continue;
        if (d.writes && !write) continue;
        if (d.route && !routeCandidates(path).some((c) => d.route.re.test(c))) continue;
        if (!best || RANK[d.action] > RANK[best.action]) best = d;
      }
      return best && { who: best.who, action: best.action, line: best.line, ...(best.until != null ? { until: new Date(best.until).toISOString() } : {}) };
    },
  };
}
