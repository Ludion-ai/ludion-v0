// Mandates an operator puts on its own agent (lane 2 spec §3.2), as the CLI asks for them and the SDK
// carries them.
//
//   npx ludion mandate create --site https://shop.example --scope read,checkout --checkout-max 5000 --currency JPY --per-day 3 --expires 24h
//
//   const me = JSON.parse(fs.readFileSync("ludion.json", "utf8"));
//   const signer = await createDiverSigner({ sessionPrivateJwk: me.session, signatureAgent: me.signature_agent, mandate: mandateFor(me) });
//
// The Registry issues a Mandate only on a statement signed by the Diver's Root, so the agent that runs
// with its session key cannot widen its own limits. `ludion mandate create` keeps each Mandate in
// ludion.json (`mandates`). mandateFor reads `mandates` and nothing else — never the Root, never a
// passphrase (MND-1) — and picks, for each request, the Mandate for the site it goes to.

/** spec §11.6: the v0 scope words. */
export const MANDATE_SCOPES = Object.freeze(["read", "account", "post", "reserve", "checkout", "delete"]);
const DEFAULT_S = 86_400, MAX_S = 7 * 86_400;
/** Under the Registry's 7 days by a minute, so a clock a little behind it does not refuse "7d". */
const MARGIN_S = 60;

export class MandateTermsError extends Error {
  constructor(message) { super(message); this.name = "MandateTermsError"; }
}

/** "24h", "90m", "7d" → seconds. */
export function parseLifetime(text) {
  const m = /^(\d{1,4})(m|h|d)$/.exec(String(text ?? "").trim());
  if (!m) throw new MandateTermsError(`--expires takes a number and m, h or d (e.g. 24h, 7d), not ${JSON.stringify(text)}`);
  const s = Number(m[1]) * { m: 60, h: 3600, d: 86_400 }[m[2]];
  if (s <= 0 || s > MAX_S) throw new MandateTermsError("--expires is at most 7d (spec §11.6: short lives, renewed)");
  return s;
}

/**
 * What `mandate create` asks the Registry for, from its flags. Throws MandateTermsError with the
 * flag to fix; nothing is sent.
 * @param {{ site?: string, scope?: string, perDay?: string, checkoutMax?: string, currency?: string, expires?: string, now?: number }} f
 */
export function mandateTerms(f) {
  let u;
  try { u = new URL(f.site); } catch { throw new MandateTermsError("--site takes the site's origin, e.g. https://shop.example"); }
  if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || u.username || u.password) throw new MandateTermsError("--site takes the site's https origin only, e.g. https://shop.example (no path)");
  const aud = u.origin;
  const scope = String(f.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!scope.length || !scope.every((s) => MANDATE_SCOPES.includes(s)) || new Set(scope).size !== scope.length) {
    throw new MandateTermsError(`--scope takes distinct words from ${MANDATE_SCOPES.join(", ")}, comma-separated`);
  }
  const int = (v, flag) => {
    if (v == null) return undefined;
    if (!/^\d{1,15}$/.test(String(v)) || Number(v) <= 0) throw new MandateTermsError(`${flag} takes a positive whole number`);
    return Number(v);
  };
  const perDay = int(f.perDay, "--per-day"), checkoutMax = int(f.checkoutMax, "--checkout-max");
  const currency = f.currency == null ? undefined : String(f.currency).toUpperCase();
  if (currency != null && !/^[A-Z]{3}$/.test(currency)) throw new MandateTermsError("--currency takes an ISO 4217 code, e.g. JPY");
  let limits;
  if (perDay != null || checkoutMax != null || currency != null) {
    // spec §11.6 limits: per checkout (checkout_max, in the currency's minor unit), and checkouts a day.
    if (checkoutMax == null || currency == null) throw new MandateTermsError("limits go with checkout: --checkout-max <amount> --currency <ISO 4217>, and --per-day <checkouts a day> if you want one");
    if (perDay != null && perDay > 1000) throw new MandateTermsError("--per-day is at most 1000");
    limits = { checkout_max: checkoutMax, currency, ...(perDay != null ? { per_day: perDay } : {}) };
  }
  if (scope.includes("checkout") && !limits) throw new MandateTermsError("a checkout Mandate carries its limits: --checkout-max <amount> --currency <ISO 4217> (and --per-day <n>)");
  if (limits && !scope.includes("checkout")) throw new MandateTermsError("--checkout-max, --currency and --per-day limit checkouts: add checkout to --scope");
  const life = f.expires == null ? DEFAULT_S : parseLifetime(f.expires);
  const now = Math.floor((f.now ?? Date.now()) / 1000);
  return { aud, scope, ...(limits ? { limits } : {}), exp: now + Math.min(life, MAX_S - MARGIN_S) };
}

/** One line for a Mandate: its site, scope and limits. */
export function describeMandate(m) {
  const l = m.limits;
  const limits = l ? `; checkout up to ${l.checkout_max} ${l.currency}${l.per_day != null ? `, ${l.per_day} a day` : ""}` : "";
  return `${m.aud} — ${m.scope.join(", ")}${limits}`;
}

/**
 * The Mandate to carry on a request: the newest one in `store.mandates` for the site the request
 * goes to, not expired and not withdrawn. Reads `store.mandates` only.
 * @param {{ mandates?: { aud: string, iat?: number, exp: number, revoked?: object, mandate: string }[] }} store
 * @returns {(req: { url: string }) => string | undefined}
 */
export function mandateFor(store, { now = () => Date.now() } = {}) {
  return (req) => {
    let origin;
    try { origin = new URL(req.url).origin; } catch { return undefined; }
    const t = Math.floor(now() / 1000);
    const live = (store.mandates ?? []).filter((m) => m && m.aud === origin && !m.revoked && m.exp > t && typeof m.mandate === "string");
    live.sort((a, b) => (b.iat ?? 0) - (a.iat ?? 0));
    return live[0]?.mandate;
  };
}
