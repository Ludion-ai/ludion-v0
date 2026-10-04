// Ludion-Purpose (spec §11.7, ADR-030): what an agent says it came to do — `read` or `act` — and an
// optional one-sentence note, as an RFC 9651 Item: `act; note=%"Add one item to the cart"`.
//
// The first word is for machines; the note is for people. Only a declaration the signature covers is
// the agent's own word; anything else is an unsigned claim, shown as such and never matched (PUR-1).
// The one rule: said `read` and wrote — a contradiction (PUR-3). A name in the User-Agent that the
// ledger lists as a crawler, search or training fetcher counts as having said `read`, so the rule works
// from day one. The note never leaves the Gate (PUR-2): it stays in the site's own records (7 days).
import { parseItem, Token, DisplayString } from "structured-headers";

export const PURPOSE_HEADER = "ludion-purpose";
export const PURPOSE_KINDS = Object.freeze(["read", "act"]);
/** The note's limits (spec §11.7): 80 characters when it holds Japanese (non-ASCII), else 140. */
export const NOTE_MAX = Object.freeze({ wide: 80, ascii: 140 });
/** Ledger kinds that only ever read (spec §11.7: collection, training, search). */
const READING_KINDS = new Set(["crawler", "search"]);

const chars = (s) => [...s].length;
/** The longest note allowed for this text. */
export const noteLimit = (s) => (/[^\x00-\x7f]/.test(s) ? NOTE_MAX.wide : NOTE_MAX.ascii);

/**
 * Parse a Ludion-Purpose field value.
 * @returns {{ kind: "read"|"act", note: string|null } | { problem: string }}
 */
export function parsePurpose(value) {
  if (typeof value !== "string" || !value.trim()) return { problem: "missing" };
  let item;
  try { item = parseItem(value); } catch { return { problem: "malformed" }; }
  const [bare, params] = item;
  const kind = bare instanceof Token ? bare.toString() : null;
  if (!PURPOSE_KINDS.includes(kind)) return { problem: "unknown_kind" };
  for (const k of params.keys()) if (k !== "note") return { problem: "unknown_parameter" };
  let note = null;
  if (params.has("note")) {
    const n = params.get("note");
    note = n instanceof DisplayString ? n.toString() : typeof n === "string" ? n : null;
    if (note == null) return { problem: "malformed_note" };
    if (chars(note) > noteLimit(note)) return { problem: "note_too_long" };
    if (/[\u0000-\u001f\u007f]/.test(note)) return { problem: "malformed_note" };
  }
  return { kind, note };
}

/**
 * The declaration on a request, and whose word it is.
 * @param {{ value?: string, covered: boolean }} o  covered: the verified signature covers ludion-purpose
 * @returns {null | { kind, note, signed: boolean } | { problem, signed: boolean }}
 */
export function readPurpose({ value, covered }) {
  if (value == null) return null;
  const p = parsePurpose(value);
  return { ...p, signed: !!covered && !p.problem };
}

/**
 * What the visit said, set against what it did (PUR-3). One rule: said `read`, or claimed a reading
 * crawler's name, and wrote — a contradiction. An unsigned declaration is not the agent's word and is
 * never matched (PUR-1).
 * @param {{ purpose?: object|null, cls: object, write: boolean }} o
 * @returns {{ said: "read"|"act"|null, by: "signature"|"crawler_name"|null, verdict: "consistent"|"contradiction"|"undeclared" }}
 */
export function purposeVerdict({ purpose, cls, write }) {
  let said = null, by = null;
  if (purpose?.signed && purpose.kind) { said = purpose.kind; by = "signature"; }
  else if (cls?.class === "DECLARED" && READING_KINDS.has(cls.kind)) { said = "read"; by = "crawler_name"; }
  if (!said) return { said: null, by: null, verdict: "undeclared" };
  return { said, by, verdict: said === "read" && write ? "contradiction" : "consistent" };
}
