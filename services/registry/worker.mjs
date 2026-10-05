// The Registry on Cloudflare Workers (ADR-041): https://registry.ludion.ai. One Durable Object
// ("registry") holds the state (createDurableStore) and runs createRegistry; the Worker forwards
// every request to it. The v0 signing key is the Worker's secret REGISTRY_SIGNING_KEY (a private
// JWK the human makes and puts there; the Registry never generates one). Spec §11.3 asks for an HSM:
// the difference and when it closes are in ADR-041.
//
// The Card Host's one question, GET /__card/<diver_id> (a Diver's public record), reaches the
// Durable Object only through its binding: the Worker answers 404 for it from the Internet.
import { createRegistry, publicDiverRecord } from "./src/index.mjs";
import { createDurableStore } from "./src/durable.mjs";

export const CARD_PREFIX = "/__card/";

/**
 * REGISTRY_LIMITS (a var: an object, or its JSON): { per_ip_per_hour, per_contact_per_day, all_per_hour }.
 * Absent or broken: none — but the production config carries them (REG-7 reads wrangler.json).
 */
export function limitsFrom(v) {
  let o = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { o = null; } }
  if (!o || typeof o !== "object") return null;
  const n = (x) => (Number.isInteger(x) && x > 0 ? x : undefined);
  const l = { perIpPerHour: n(o.per_ip_per_hour), perContactPerDay: n(o.per_contact_per_day), allPerHour: n(o.all_per_hour) };
  return Object.values(l).some(Boolean) ? l : null;
}
const DIVER_ID = /^dvr-[a-z2-7]{16}$/;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export class RegistryState {
  /** @param {{ storage: object }} ctx  @param {Record<string, string>} env */
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  /** Start once; a start that failed (a storage hiccup) is forgotten, so the next request tries again. */
  ready() {
    return (this.started ??= (async () => {
      this.store = await createDurableStore(this.ctx.storage);
      this.registry = await createRegistry({
        key: JSON.parse(this.env.REGISTRY_SIGNING_KEY),
        issuer: this.env.REGISTRY_ISSUER || "https://registry.ludion.ai",
        origin: this.env.REGISTRY_ORIGIN || "https://registry.ludion.ai",
        store: this.store,
        limits: limitsFrom(this.env.REGISTRY_LIMITS),
        pauseNew: this.env.REGISTRY_PAUSE_NEW === "1" || this.env.REGISTRY_PAUSE_NEW === true,
      });
    })().catch((e) => { this.started = undefined; throw e; }));
  }

  async fetch(request) {
    await this.ready();
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(CARD_PREFIX)) return this.publicDiver(pathname.slice(CARD_PREFIX.length));
    return this.registry.fetch(request);
  }

  /** What a card and a directory are made of: public members only. Revoked or unknown: 404. */
  async publicDiver(id) {
    if (!DIVER_ID.test(id)) return json(404, { error: "unknown_agent" });
    const rec = await this.store.getDiver(id);
    if (!rec || rec.revoked) return json(404, { error: "unknown_agent" });
    return json(200, await publicDiverRecord(rec));
  }
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith(CARD_PREFIX)) return json(404, { error: "not_found" });
    return env.REGISTRY.get(env.REGISTRY.idFromName("registry")).fetch(request);
  },
};
