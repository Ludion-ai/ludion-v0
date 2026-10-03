// The Registry on Cloudflare Workers (ADR-041): https://registry.ludion.ai. One Durable Object
// ("registry") holds the state (createDurableStore) and runs createRegistry; the Worker forwards
// every request to it. The v0 signing key is the Worker's secret REGISTRY_SIGNING_KEY (a private
// JWK the human makes and puts there; the Registry never generates one). Spec §11.3 asks for an HSM:
// the difference and when it closes are in ADR-041.
//
// The Card Host's one question, GET /__card/<diver_id> (a Diver's public record), reaches the
// Durable Object only through its binding: the Worker answers 404 for it from the Internet.
import { createRegistry, okpThumbprint } from "./src/index.mjs";
import { createDurableStore } from "./src/durable.mjs";

export const CARD_PREFIX = "/__card/";
const DIVER_ID = /^dvr-[a-z2-7]{16}$/;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export class RegistryState {
  /** @param {{ storage: object }} ctx  @param {Record<string, string>} env */
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  ready() {
    return (this.started ??= (async () => {
      this.store = await createDurableStore(this.ctx.storage);
      this.registry = await createRegistry({
        key: JSON.parse(this.env.REGISTRY_SIGNING_KEY),
        issuer: this.env.REGISTRY_ISSUER || "https://registry.ludion.ai",
        origin: this.env.REGISTRY_ORIGIN || "https://registry.ludion.ai",
        store: this.store,
      });
    })());
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
    return json(200, {
      diver_id: rec.diver_id, name: rec.name, contacts: rec.contacts,
      root_kid: await okpThumbprint(rec.root),
      keys: (rec.keys ?? []).map((k) => ({ kty: k.kty, crv: k.crv, x: k.x, kid: k.kid })),
    });
  }
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith(CARD_PREFIX)) return json(404, { error: "not_found" });
    return env.REGISTRY.get(env.REGISTRY.idFromName("registry")).fetch(request);
  },
};
