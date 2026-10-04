// The Card Host on Cloudflare Workers (ADR-041, PRIV-5): https://<diver_id>.agents.ludion.ai serves
// that Diver's key directory and card (CIMD). Read-only and keeps nothing: for a request it asks the
// Registry one question — the public record of the Diver whose id is the host's first label — in a
// request of its own, carrying nothing of the visitor's (no IP, User-Agent, time, header or path).
// It writes nothing and logs nothing; the Worker runs with observability and logpush off
// (wrangler.json). A revoked or unknown Diver is 404.
import { createCardHost } from "./src/index.mjs";
import { cardDocument, clientDocument, directoryDocument } from "@ludion/diver/card";

export const AGENTS_SUFFIX = ".agents.ludion.ai";
export const REGISTRY_ORIGIN = "https://registry.ludion.ai";
const DIVER_ID = /^dvr-[a-z2-7]{16}$/;

/** lookup(host, origin) for createCardHost, through the Registry's Durable Object namespace. */
export function registryLookup(namespace, { suffix = AGENTS_SUFFIX } = {}) {
  return async (host, origin = `https://${host}`) => {
    if (!host.endsWith(suffix)) return undefined;
    const id = host.slice(0, -suffix.length);
    if (!DIVER_ID.test(id)) return undefined;
    const stub = namespace.get(namespace.idFromName("registry"));
    const r = await stub.fetch(new Request(`https://registry.internal/__card/${id}`));
    if (!r.ok) return undefined;
    const rec = await r.json();
    return {
      directory: directoryDocument(rec.keys),
      card: cardDocument({ origin, name: rec.name ?? "Unnamed agent", contacts: rec.contacts ?? [], ludion: { diver_id: rec.diver_id, registry: REGISTRY_ORIGIN, root_kid: rec.root_kid } }),
      client: clientDocument({ origin, name: rec.name ?? "Unnamed agent", contacts: rec.contacts ?? [] }),
    };
  };
}

export default {
  fetch(request, env) {
    return createCardHost({ lookup: registryLookup(env.REGISTRY) }).fetch(request);
  },
};
