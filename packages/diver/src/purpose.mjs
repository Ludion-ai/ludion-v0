// What the agent says it came to do (spec §11.7, ADR-030): `Ludion-Purpose: act; note=%"…"`, signed.
// The note says what the agent will do on this site, never who the user is or why. Before anything is
// sent, the note is held to that (PUR-6): no email address, phone number, URL or long number, and at
// most 80 characters with Japanese, 140 without. A note that fails is not sent; the request is not
// sent either — the caller fixes the note.
import { serializeItem, Token, DisplayString } from "structured-headers";

export const PURPOSE_KINDS = Object.freeze(["read", "act"]);
export const NOTE_MAX = Object.freeze({ wide: 80, ascii: 140 });

export class PurposeError extends Error {
  constructor(code, message) { super(message); this.name = "PurposeError"; this.code = code; }
}

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/;
const URLISH = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.)|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S*/i;
/** A run of digits, spaces, dots, dashes and brackets holding 7 digits or more: a phone, card or account number. */
const LONG_DIGITS = /[\d][\d\s().\-‐－]{5,}[\d]/g;

/** Why this note may not be sent, or null. NFKC first, so full-width digits and letters count too. */
export function noteProblem(note) {
  if (note == null) return null;
  if (typeof note !== "string") return "note must be a string";
  const n = note.normalize("NFKC");
  if (!n.trim()) return "note is empty";
  if (/[\u0000-\u001f\u007f]/.test(n)) return "note has control characters";
  const max = /[^\x00-\x7f]/.test(note) ? NOTE_MAX.wide : NOTE_MAX.ascii;
  if ([...note].length > max) return `note is longer than ${max} characters`;
  if (EMAIL.test(n)) return "note contains an email address";
  if (URLISH.test(n)) return "note contains a URL";
  for (const m of n.matchAll(LONG_DIGITS)) if ((m[0].match(/\d/g) ?? []).length >= 7) return "note contains a phone number or a long number";
  return null;
}

/**
 * The Ludion-Purpose field value for a declaration. Throws PurposeError for an unknown kind or a note
 * that must not be sent.
 * @param {{ kind: "read"|"act", note?: string }} p
 */
export function purposeField(p) {
  if (!p || !PURPOSE_KINDS.includes(p.kind)) throw new PurposeError("kind", `purpose.kind must be "read" or "act" (got ${JSON.stringify(p?.kind)})`);
  const why = noteProblem(p.note);
  if (why) throw new PurposeError("note", `${why}: say what the agent will do on this site, not who the user is (spec §11.7)`);
  const params = new Map(p.note == null ? [] : [["note", new DisplayString(p.note)]]);
  return serializeItem([new Token(p.kind), params]);
}

/** What to say when a site asks (purpose_required) and the caller said nothing: a write acts, the rest reads. */
export const purposeForMethod = (method) => (["POST", "PUT", "PATCH", "DELETE"].includes(String(method).toUpperCase()) ? "act" : "read");
