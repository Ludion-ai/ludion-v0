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
 * Signature Agent Card = OAuth Client ID Metadata Document + web_bot_auth object
 * (draft-meunier-webbotauth-registry-03). Ludion's accountability fields live in
 * one top-level `ludion` object so any CIMD/Web Bot Auth consumer can ignore them.
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
    web_bot_auth: { trigger: "fetcher", ...(x.webBotAuth ?? {}) },
    ludion: { version: 0, ...(x.ludion ?? {}) },
  };
}
