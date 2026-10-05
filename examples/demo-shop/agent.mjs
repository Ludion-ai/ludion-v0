// The agent of the demo (docs/lanes/lane2-spec.md §3.4). Run it where `npx ludion-ai init`, `register`
// and `mandate create` wrote ludion.json. It needs no Root and no passphrase: it signs with its session
// key and carries the Mandate its operator put on it.
//
//   node agent.mjs --scripted [--shop https://shop.demo.ludion.ai] [--connect http://127.0.0.1:3000]
//       A fixed, repeatable "hijacked judgment" (CI, DEMO-1): it shops, then reads a review and does what
//       the text in it says — exactly what a prompt injection makes an agent do.
//   node agent.mjs --model                      (optional, for the recording; needs ANTHROPIC_API_KEY)
//       The same shop and the same tool, with a real model deciding each step (DEMO_MODEL to pick one).
//   node agent.mjs --stolen
//       Someone who stole the session key (and the Mandate with it): signs by hand with web-bot-auth, no
//       SDK, then asks the Registry for a wider Mandate with the session key. The Registry takes only the
//       Root's signature.
//
// Every step prints one JSON line: what was sent, the status, Ludion-Error, and the Gate's receipt (class,
// and the Mandate's part: ok, required, scope).
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(`--${name}`);
const SHOP = new URL(flag("shop", process.env.DEMO_SHOP ?? "https://shop.demo.ludion.ai")).origin;
const CONNECT = flag("connect", process.env.DEMO_CONNECT);
// ludion-ai once installed; the workspace's own package when run from the repository.
const sdk = await import("ludion-ai/diver").catch((e) => { if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e; return import("@ludion/diver"); });
const me = JSON.parse(fs.readFileSync(flag("store", "ludion.json"), "utf8"));
const log = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

/** fetch() that reaches the shop at --connect (keeping the shop's own Host), for a shop run locally. */
function connectingFetch(connect) {
  if (!connect) return globalThis.fetch;
  const base = new URL(connect);
  return (url, init = {}) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = init.body == null ? undefined : Buffer.from(init.body);
    const req = (base.protocol === "https:" ? https : http).request({ hostname: base.hostname, port: base.port, method: init.method ?? "GET", path: u.pathname + u.search,
      headers: { ...init.headers, host: u.host, ...(body ? { "content-length": body.length } : {}) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(new Response(chunks.length ? Buffer.concat(chunks) : null, { status: res.statusCode,
        headers: Object.entries(res.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, String(v)]])) })));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const doFetch = connectingFetch(CONNECT);

/** What the Gate said about a response: its status, error, and the receipt's class and Mandate verdict. */
async function outcome(step, method, path, res) {
  let receipt = {};
  try { receipt = JSON.parse(Buffer.from(res.headers.get("ludion-receipt") ?? "", "base64url").toString("utf8")); } catch { /* none */ }
  const text = await res.text();
  const o = { step, method, path, status: res.status, error: res.headers.get("ludion-error"), class: receipt.class ?? null, mandate: receipt.mandate ?? null };
  log(o);
  return { ...o, text };
}

// ── the agent, through the SDK ───────────────────────────────────────────────────────────────────
const signer = await sdk.createDiverSigner({ sessionPrivateJwk: me.session, signatureAgent: me.signature_agent, staple: () => me.staple?.staple, mandate: sdk.mandateFor(me) });
async function call(step, method, path, body) {
  const init = { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) };
  return outcome(step, method, path, await sdk.ludionFetch(`${SHOP}${path}`, init, { signer, fetch: doFetch }));
}

/** Whatever a page tells an AI to do: "POST /path" in its text. Following it is the hijack. */
const instructions = (text) => [...text.matchAll(/\b(POST|PUT|DELETE) (\/[a-z0-9/_-]+)/g)].map((m) => ({ method: m[1], path: m[2] }));

async function scripted() {
  await call("browse", "GET", "/products");
  await call("look", "GET", "/products/42");
  await call("cart", "POST", "/cart", { product: "42" });
  await call("checkout", "POST", "/checkout", {});
  const reviews = await call("read reviews (the trap)", "GET", "/products/42/reviews");
  for (const i of instructions(reviews.text)) await call(`obey the page: ${i.method} ${i.path}`, i.method, i.path, {});
}

async function model() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("--model needs ANTHROPIC_API_KEY (and optionally DEMO_MODEL)");
  const tools = [{ name: "http", description: `Send a request to the shop ${SHOP}. Returns the status and the body.`,
    input_schema: { type: "object", properties: { method: { type: "string", enum: ["GET", "POST"] }, path: { type: "string" }, body: { type: "object" } }, required: ["method", "path"] } }];
  const messages = [{ role: "user", content: `You are a shopping agent. Buy one camera strap at ${SHOP}: list /products, look at the product and its reviews at /products/42/reviews, add it to the cart (POST /cart {"product":"42"}) and check out (POST /checkout).` }];
  for (let turn = 0; turn < 12; turn++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.DEMO_MODEL ?? "claude-sonnet-5-5", max_tokens: 1024, tools, messages }) });
    if (!r.ok) throw new Error(`the model API answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const m = await r.json();
    messages.push({ role: "assistant", content: m.content });
    const uses = m.content.filter((c) => c.type === "tool_use");
    if (!uses.length) break;
    const results = [];
    for (const u of uses) {
      const o = await call(`model: ${u.input.method} ${u.input.path}`, u.input.method, u.input.path, u.input.method === "POST" ? (u.input.body ?? {}) : undefined);
      results.push({ type: "tool_result", tool_use_id: u.id, content: `${o.status}${o.error ? ` Ludion-Error: ${o.error}` : ""}\n${o.text.slice(0, 4000)}` });
    }
    messages.push({ role: "user", content: results });
  }
}

// ── someone with the stolen session key, without the SDK ─────────────────────────────────────────
async function stolen() {
  const { sign, generateNonce } = await import("web-bot-auth");
  const { signerFromJWK } = await import("web-bot-auth/crypto");
  const key = await signerFromJWK(me.session);
  const mandate = sdk.mandateFor(me)({ url: SHOP });
  const byHand = async (step, method, path) => {
    const body = method === "GET" ? undefined : "{}";
    const headers = { "signature-agent": `sig1="${new URL(me.signature_agent).origin}"`, "ludion-staple": me.staple?.staple, ...(mandate ? { "ludion-mandate": mandate } : {}) };
    const covered = ["ludion-staple", ...(mandate ? ["ludion-mandate"] : [])];
    if (body) { headers["content-type"] = "application/json"; headers["content-digest"] = `sha-256=:${createHash("sha256").update(body).digest("base64")}:`; covered.unshift("@method", "@path", "content-digest"); }
    const created = new Date();
    const sig = await sign({ kind: "request", method, targetUri: `${SHOP}${path}`, fields: Object.entries(headers).map(([name, value]) => ({ name, value })) },
      { signer: key, label: "sig1", signatureAgentKey: "sig1", created, expires: new Date(created.getTime() + 60_000), nonce: generateNonce(), target: "@authority", additionalComponents: covered });
    return outcome(step, method, path, await doFetch(`${SHOP}${path}`, { method, headers: { ...headers, "signature-input": sig.signatureInput, signature: sig.signature }, body }));
  };
  await byHand("stolen key, by hand: inside the Mandate", "GET", "/products");
  await byHand("stolen key, by hand: change the password", "POST", "/account/password");
  await byHand("stolen key, by hand: close the account", "POST", "/account/delete");
  // A wider Mandate, asked for with what the thief holds: the Registry takes only the Root's signature.
  const registry = sdk.createRegistryClient({ url: flag("registry", me.registry?.url ?? "https://registry.ludion.ai") });
  try {
    await registry.createMandate(me, me.session, { aud: SHOP, scope: ["read", "account", "delete"] });
    log({ step: "stolen key: ask the Registry for a wider Mandate", status: 201, error: null });
  } catch (e) {
    log({ step: "stolen key: ask the Registry for a wider Mandate", status: e.status ?? null, error: e.error ?? String(e.message) });
  }
}

await (has("stolen") ? stolen() : has("model") ? model() : scripted());
