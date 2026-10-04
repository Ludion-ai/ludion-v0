// The OAuth flow an MCP client runs with its card URL as client_id (ADR-039): authorization code with
// PKCE to a loopback redirect, the person logs in and consents (here: this file posts Keycloak's own
// forms, as the person's browser would), then the agent redeems the code at the token endpoint with
// a private_key_jwt client assertion signed by its session key (clientAssertion in @ludion/diver).
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

const form = (o) => new URLSearchParams(o);
const decodeJwt = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));

/** A loopback listener that takes one authorization response. */
async function loopback(host = "127.0.0.1") {
  let resolve;
  const got = new Promise((ok) => { resolve = ok; });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://${host}`);
    res.writeHead(200, { "content-type": "text/plain" }).end("You can close this window.");
    if (u.pathname === "/callback") resolve(Object.fromEntries(u.searchParams));
  });
  await new Promise((ok) => server.listen(0, host, ok));
  const port = server.address().port;
  return { redirect: `http://${host.includes(":") ? `[${host}]` : host}:${port}/callback`, got, close: () => server.close() };
}

/**
 * Run the flow. Every step is recorded; the result says how far it got and why it stopped.
 * @param {{ server: string, realm: string, clientId: string, user: { username: string, password: string },
 *           assertion: (audience: string) => string, redirect?: string, reuseAssertion?: string,
 *           auth?: (tokenEndpoint: string) => Record<string, string> }} o
 *   assertion(audience) makes the client assertion for the token endpoint; redirect overrides the
 *   loopback one (to try a redirect the card does not list); auth(tokenEndpoint), when given, is how the
 *   client authenticates at the token endpoint instead of the private_key_jwt assertion (MCP-3).
 * @returns {Promise<{ stage: "authorize"|"login"|"consent"|"callback"|"token"|"done", steps: string[], error?: string,
 *                     code?: string, token?: object, claims?: object, assertionUsed?: string }>}
 */
export async function runFlow({ server, realm, clientId, user, assertion, redirect: redirectOverride, reuseAssertion, auth }) {
  const base = `${server}/realms/${realm}/protocol/openid-connect`;
  const steps = [];
  const lb = await loopback();
  const redirect = redirectOverride ?? lb.redirect;
  const jar = new Map();
  const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const go = async (url, init = {}) => { const r = await fetch(new URL(url, server), { redirect: "manual", ...init, headers: { cookie: cookie(), ...(init.headers ?? {}) } }); keep(r); return r; };
  const formsOf = (html) => [...html.matchAll(/<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)].map((m) => ({
    action: m[1].replaceAll("&amp;", "&"), id: /id="([^"]+)"/.exec(m[0])?.[1],
    hidden: Object.fromEntries([...m[2].matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)].map((h) => [h[1], h[2]])) }));
  const errorOf = (html) => (/id="input-error[^"]*"[^>]*>([^<]+)</.exec(html) ?? /class="[^"]*(?:kc-feedback-text|alert-error|pf-m-danger)[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([^<]+)</.exec(html))?.[1]?.trim();
  try {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(8).toString("hex");
    const authorize = `${base}/auth?${form({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: "openid", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" })}`;
    let r = await go(authorize);
    let html = await r.text();
    const login = formsOf(html).find((f) => f.id === "kc-form-login");
    steps.push(`authorize ${r.status}${login ? " (login form)" : ""}`);
    if (!login) return { stage: "authorize", steps, error: errorOf(html) ?? `HTTP ${r.status}` };

    r = await go(login.action, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ ...login.hidden, username: user.username, password: user.password, credentialId: "" }) });
    let loc = r.headers.get("location");
    steps.push(`login ${r.status}`);
    if (!loc) return { stage: "login", steps, error: errorOf(await r.text()) ?? `HTTP ${r.status}` };

    if (!loc.startsWith(redirect)) {
      // Keycloak asks the person to consent to a CIMD client: accept, as the person would.
      r = await go(loc);
      html = await r.text();
      const consent = formsOf(html).find((f) => /login-actions\/consent/.test(f.action));
      if (!consent) return { stage: "consent", steps, error: errorOf(html) ?? `no consent form (HTTP ${r.status})` };
      r = await go(consent.action, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ ...consent.hidden, accept: "Yes" }) });
      loc = r.headers.get("location");
      steps.push(`consent ${r.status}`);
      if (!loc?.startsWith(redirect)) return { stage: "consent", steps, error: loc ? `redirected to ${loc}` : errorOf(await r.text()) ?? `HTTP ${r.status}` };
    }
    if (redirectOverride) return { stage: "callback", steps, error: `the server sent the code to ${loc.split("?")[0]}` };
    await fetch(loc);
    const cb = await lb.got;
    steps.push(`callback ${cb.code ? "code" : cb.error}`);
    if (!cb.code || cb.state !== state) return { stage: "callback", steps, error: cb.error_description ?? cb.error ?? "state mismatch" };

    const assertionUsed = auth ? undefined : reuseAssertion ?? assertion(`${base}/token`);
    const clientAuth = auth ? auth(`${base}/token`) : { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertionUsed };
    r = await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({
      grant_type: "authorization_code", code: cb.code, redirect_uri: redirect, code_verifier: verifier, client_id: clientId, ...clientAuth }) });
    const token = await r.json();
    steps.push(`token ${r.status}${token.error ? ` ${token.error}` : ""}`);
    if (!r.ok || !token.access_token) return { stage: "token", steps, code: cb.code, assertionUsed, error: `${token.error ?? r.status}${token.error_description ? `: ${token.error_description}` : ""}` };
    return { stage: "done", steps, code: cb.code, token, claims: decodeJwt(token.access_token), assertionUsed };
  } finally { lb.close(); }
}

/** What is wrong with a flow that should have authorized `clientId` (the MCP-1 judge). */
export function authorizedProblems(result, { clientId, issuer }) {
  const out = [];
  if (result.stage !== "done") out.push(`stopped at ${result.stage}: ${result.error ?? "?"}`);
  else {
    if (result.claims?.azp !== clientId) out.push(`the token is for ${result.claims?.azp}, not ${clientId}`);
    if (issuer && result.claims?.iss !== issuer) out.push(`the token was issued by ${result.claims?.iss}, not ${issuer}`);
    if (!(result.claims?.exp > Math.floor(Date.now() / 1000))) out.push("the token has expired");
    if (String(result.token?.token_type).toLowerCase() !== "bearer") out.push(`token_type ${result.token?.token_type}`);
  }
  return out;
}
