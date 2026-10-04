// A Diver's two public documents, with no crypto and no Node built-in (so the Card Host Worker can
// build them: ADR-041). keys.mjs re-exports them; `@ludion/diver/card` is this file alone.
import { HTTP_MESSAGE_SIGNATURES_DIRECTORY } from "web-bot-auth";

/**
 * The HTTP Message Signatures Directory (JWKS) served at
 * /.well-known/http-message-signatures-directory. Contains SESSION keys only —
 * the Root key never appears in the directory because it never signs requests.
 * kid MUST equal the thumbprint (draft §5.5).
 */
export function directoryDocument(sessionPublicJwks, { nbf, exp } = {}) {
  return {
    keys: sessionPublicJwks.map((k) => ({
      kty: "OKP", crv: "Ed25519", kid: k.kid, x: k.x, use: "sig",
      ...(nbf ? { nbf } : {}), ...(exp ? { exp } : {}),
    })),
  };
}

export const DIRECTORY_MEDIA_TYPE = "application/http-message-signatures-directory+json";
export { HTTP_MESSAGE_SIGNATURES_DIRECTORY };

/**
 * Where an MCP client receives its authorization code (ADR-039, RFC 8252 §7.3): loopback only, any
 * port. A CLI agent has no public URL, and none is needed.
 */
export const LOOPBACK_REDIRECT_URIS = Object.freeze(["http://127.0.0.1/callback", "http://[::1]/callback"]);

/** Where an agent's OAuth client document lives: its MCP client_id (ADR 2026-10-04-mcp-client-document). */
export const CLIENT_PATH = "/client";

/**
 * The agent's client metadata for MCP authorization servers (CIMD): the same name and the same keys
 * (jwks_uri) as its card, and nothing an authorization server does not know — no web_bot_auth, no
 * ludion object — so a strict server takes it (Keycloak 26.8 refuses unknown members:
 * keycloak/keycloak#51236). Loopback redirect_uris, the code flow, private_key_jwt (ADR-039).
 * @param {{ origin: string, name: string, contacts?: string[], about?: string, logo?: string }} x
 */
export function clientDocument(x) {
  const origin = new URL(x.origin).origin;
  return {
    client_id: `${origin}${CLIENT_PATH}`,
    client_name: x.name,
    ...(x.about ? { client_uri: x.about } : {}),
    ...(x.logo ? { logo_uri: x.logo } : {}),
    ...(x.contacts?.length ? { contacts: x.contacts } : {}),
    jwks_uri: `${origin}${HTTP_MESSAGE_SIGNATURES_DIRECTORY}`,
    redirect_uris: [...LOOPBACK_REDIRECT_URIS],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "private_key_jwt",
  };
}

/**
 * Signature Agent Card = OAuth Client ID Metadata Document + web_bot_auth object
 * (draft-meunier-webbotauth-registry-03). Ludion's accountability fields live in
 * one top-level `ludion` object so any CIMD/Web Bot Auth consumer can ignore them.
 * The same URL is the MCP client_id (spec §11.2, ADR-039): loopback redirect_uris, and the client
 * authenticates with private_key_jwt — a session key from jwks_uri, never a shared secret.
 *
 * @param {{ origin: string, name: string, contacts: string[], about?: string, logo?: string,
 *           webBotAuth?: object, ludion?: { diver_id: string, registry?: string, root_kid?: string } }} x
 */
export function cardDocument(x) {
  const origin = new URL(x.origin).origin;
  return {
    client_id: `${origin}/card`,
    client_name: x.name,
    ...(x.about ? { client_uri: x.about } : {}),
    ...(x.logo ? { logo_uri: x.logo } : {}),
    contacts: x.contacts,
    jwks_uri: `${origin}${HTTP_MESSAGE_SIGNATURES_DIRECTORY}`,
    redirect_uris: [...LOOPBACK_REDIRECT_URIS],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "private_key_jwt",
    web_bot_auth: { trigger: "fetcher", ...(x.webBotAuth ?? {}) },
    ludion: { version: 0, ...(x.ludion ?? {}) },
  };
}
