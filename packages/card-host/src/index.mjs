// @ludion/card-host — serves a Diver's key directory and Signature Agent Card (spec §10.2).
//
//   https://dvr-xxxx.agents.ludion.ai/.well-known/http-message-signatures-directory
//   https://dvr-xxxx.agents.ludion.ai/card
//
// Fetch API only (Request → Response), so the same code runs on Node, workerd, Deno and Bun.
// It never redirects (verifiers must not follow them, draft §6.7), serves only the public
// members of keys whatever it is handed, and refuses to serve a card whose client_id is not
// the URL it is served at (CIMD parsers reject it; better to fail here, loudly). Nor does it serve a
// card or a client document that does not say token_endpoint_auth_method "private_key_jwt": the
// client_id is public, and only the agent's key at the token endpoint keeps anyone else from using it
// (MCP-3, MCP-4). A public client ("none") or a shared secret would hand the name to whoever asks.

export const DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";
export const DIRECTORY_MEDIA_TYPE = "application/http-message-signatures-directory+json";
export const CARD_PATH = "/card";
/** The agent's OAuth client document: its MCP client_id. */
export const CLIENT_PATH = "/client";

// Public JWK members for the key types a directory may carry. Everything else (d, p, q, dp,
// dq, qi, k, oth, …) is dropped, never served.
const PUBLIC_MEMBERS = { OKP: ["kty", "crv", "x"], EC: ["kty", "crv", "x", "y"], RSA: ["kty", "n", "e"] };
const META_MEMBERS = ["kid", "use", "alg", "nbf", "exp"];

export function publicDirectory(directory) {
  const keys = [];
  for (const k of directory?.keys ?? []) {
    const pub = PUBLIC_MEMBERS[k?.kty];
    if (!pub) continue;
    keys.push(Object.fromEntries([...pub, ...META_MEMBERS].filter((m) => k[m] !== undefined).map((m) => [m, k[m]])));
  }
  return { keys };
}

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** RFC 7638 thumbprint of an OKP public key (WebCrypto digest, so it runs on every runtime). */
async function okpThumbprint(k) {
  const canonical = JSON.stringify({ crv: k.crv, kty: "OKP", x: k.x });
  return b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))));
}

/**
 * What may be served as a key set: public members only, and never the Diver's Root key.
 * The Root never signs requests (spec §10.3), so a key whose thumbprint (or claimed kid) is the
 * card's `ludion.root_kid` is dropped, even when the publisher put it there by mistake.
 */
export async function servableKeys(keySet, card) {
  const pub = publicDirectory(keySet);
  const rootKid = typeof card?.ludion?.root_kid === "string" ? card.ludion.root_kid : undefined;
  if (!rootKid) return pub;
  const keys = [];
  for (const k of pub.keys) {
    if (k.kid === rootKid || (k.kty === "OKP" && typeof k.x === "string" && await okpThumbprint(k) === rootKid)) continue;
    keys.push(k);
  }
  return { keys };
}

const json = (status, body, type = "application/json", maxAge = 300) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": type, "cache-control": `max-age=${maxAge}`, "x-content-type-options": "nosniff" },
});
/** The only way a served card or client document may say its client authenticates. */
export const TOKEN_AUTH_METHOD = "private_key_jwt";

const problem = (status, error, headers = {}) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/**
 * @param {{ lookup: (host: string) => ({ directory: object, card?: object } | undefined | Promise<any>), maxAgeS?: number }} options
 *   lookup: the published documents for a host (lower-case, no port), or undefined. Its second
 *   argument is the origin the request reached (with a port when not the default one), so a card
 *   built on the fly can name the URL it is served at.
 * @returns {{ fetch: (request: Request) => Promise<Response> }}
 */
export function createCardHost({ lookup, maxAgeS = 300 }) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "GET" && request.method !== "HEAD") return problem(405, "method_not_allowed");
      if (url.pathname !== DIRECTORY_PATH && url.pathname !== CARD_PATH && url.pathname !== CLIENT_PATH) return problem(404, "not_found");
      const host = url.hostname.toLowerCase();
      let docs;
      // A lookup that throws could not answer now (its source failed or is unreachable): 503, never
      // "unknown agent" for an agent that may well exist. Gates retry after their negative cache.
      try { docs = await lookup(host, url.origin); } catch { return problem(503, "registry_unavailable", { "retry-after": "30" }); }
      if (!docs) return problem(404, "unknown_agent");
      if (url.pathname === DIRECTORY_PATH) return json(200, await servableKeys(docs.directory, docs.card), DIRECTORY_MEDIA_TYPE, maxAgeS);
      if (url.pathname === CLIENT_PATH) {
        if (!docs.client) return problem(404, "no_client");
        if (docs.client.client_id !== `${url.origin}${CLIENT_PATH}`) return problem(500, "client_id_mismatch");
        if (docs.client.token_endpoint_auth_method !== TOKEN_AUTH_METHOD) return problem(500, "not_private_key_jwt");
        return json(200, docs.client, "application/json", maxAgeS);
      }
      if (!docs.card) return problem(404, "no_card");
      const here = `${url.origin}${CARD_PATH}`;
      if (docs.card.client_id !== here) return problem(500, "card_client_id_mismatch");
      if (docs.card.token_endpoint_auth_method !== TOKEN_AUTH_METHOD) return problem(500, "not_private_key_jwt");
      if (docs.card.jwks) return json(200, { ...docs.card, jwks: await servableKeys(docs.card.jwks, docs.card) }, "application/json", maxAgeS);
      return json(200, docs.card, "application/json", maxAgeS);
    },
  };
}

/**
 * Node http adapter: `http.createServer(nodeListener(host, { origin }))`.
 * `scheme` is what the host is reached with behind TLS termination (default https).
 */
export function nodeListener(cardHost, { scheme = "https" } = {}) {
  return async (req, res) => {
    try {
      const r = await cardHost.fetch(new Request(`${scheme}://${req.headers.host ?? "invalid"}${req.url}`, { method: req.method }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"internal"}');
    }
  };
}
