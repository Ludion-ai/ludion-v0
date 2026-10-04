// A site on the real gate-node middleware, configured from config TEXT (the file a site edits), and
// the visitors BLK-1 and ONE-3 send: a person, a Ludion agent (signed, with a Staple), a signed agent
// outside Ludion, a crawler's name in a User-Agent (unsigned), and unnamed automation. The app
// answers the same bytes to everyone; whatever differs is the Gate's doing.
import http from "node:http";
import { ludionGate } from "../index.mjs";
import { gateConfig } from "@ludion/gate-core/config";
import { generateSiteKey } from "@ludion/gate-core";
import { keypair, signed, staple, AGENT, ATTACKER, NOW_MS, REGISTRY_ISS } from "../../gate-core/test/support.mjs";

export const HOST = "shop.example";
export const DIVER_ID = "dvr-aaaaaaaaaaaaaaaa";
export const SIGNER = new URL(ATTACKER).hostname; // a signed agent outside Ludion, named by its host
export const VISITORS = ["person", "diver", "signer", "crawler", "unnamed"];
const UA = {
  person: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  crawler: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  unnamed: "python-requests/2.32.3",
};

/** Keys for the agents and the Registry, made once per test file. */
export async function makeWorld() {
  return { agent: await keypair(), other: await keypair(), registry: await keypair(), siteKey: (await generateSiteKey()).privateJwk };
}

/** The config text a site starts from (one key or element per line, so one decision is one line). */
export function baseConfig(world, { routes = ['{ "match": "/checkout/**", "pressure": 2 }'], extra = [] } = {}) {
  return [
    "{",
    `  "site_id": "site-${HOST.replace(".", "-")}",`,
    ...extra.map((l) => `  ${l}`),
    `  "authorities": ["${HOST}"],`,
    `  "registry": { "keys": [${JSON.stringify(world.registry.publicJwk)}], "issuer": "${REGISTRY_ISS}" },`,
    '  "routes": [',
    ...routes.map((r, i) => `    ${r}${i < routes.length - 1 ? "," : ""}`),
    "  ],",
    '  "decisions": [',
    "  ]",
    "}",
  ].join("\n");
}

/** Insert one line after the first line matching `after` (a decision, a route, a key): the one-line edit. */
export function addLine(text, after, line) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => after.test(l));
  if (i < 0) throw new Error(`no line matches ${after}`);
  return [...lines.slice(0, i + 1), line, ...lines.slice(i + 1)].join("\n");
}

/** Lines added and removed going from a to b (multiset): how many lines an edit took. */
export function lineDiff(a, b) {
  const count = (t) => t.split("\n").reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());
  const A = count(a), B = count(b);
  let added = 0, removed = 0;
  for (const [l, n] of B) added += Math.max(0, n - (A.get(l) ?? 0));
  for (const [l, n] of A) removed += Math.max(0, n - (B.get(l) ?? 0));
  return { added, removed };
}

/** Start the site from config text. */
export async function startSite(world, text, { now = () => NOW_MS, onFriction } = {}) {
  const cfg = await gateConfig(JSON.parse(text), { siteKey: world.siteKey });
  const mw = await ludionGate({ ...cfg, now, resolver: { fetch: async () => new Response("", { status: 404 }) }, ...(onFriction ? { onFriction } : {}) });
  await mw.gate.resolver.prime({ type: "directory", uri: AGENT }, { keys: [{ ...world.agent.publicJwk, use: "sig" }] });
  await mw.gate.resolver.prime({ type: "directory", uri: ATTACKER }, { keys: [{ ...world.other.publicJwk, use: "sig" }] });
  const seen = [];
  const server = http.createServer((req, res) => {
    res.sendDate = false;
    res.on("finish", () => seen.push({ class: req.ludion?.cls?.class, diverId: req.ludion?.cls?.diverId ?? null, token: req.ludion?.cls?.token ?? null }));
    mw(req, res, () => {
      const body = `ok ${req.method} ${req.url}\n`;
      res.writeHead(200, { "content-type": "text/plain", "content-length": Buffer.byteLength(body) });
      res.end(body);
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { port: server.address().port, gate: mw.gate, now, seen, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
}

/** The headers a visitor sends for one request, signed at `at` (the site's clock). */
async function headersFor(world, who, method, path, at) {
  const url = `https://${HOST}${path}`, created = Math.floor(at / 1000);
  const fields = (req) => Object.fromEntries(req.fields.map((f) => [f.name, f.value]));
  if (who === "diver") {
    const s = await staple(world.registry, { sub: DIVER_ID, jkt: world.agent.kid, depth: 1, iat: created, exp: created + 3600 });
    return fields(await signed({ key: world.agent, agent: AGENT, method, url, created, headers: { "ludion-staple": s }, extraComponents: ["ludion-staple"] }));
  }
  if (who === "signer") return fields(await signed({ key: world.other, agent: ATTACKER, method, url, created }));
  return { "user-agent": UA[who], accept: "text/html,*/*" };
}

/** One request; the whole response as it reached the visitor: status, every header, the body. */
export async function visit(site, world, who, method = "GET", path = "/", { at = site.now() } = {}) {
  const headers = { host: HOST, ...(await headersFor(world, who, method, path, at)), ...(method === "GET" ? {} : { "content-length": "0" }) };
  return new Promise((ok, no) => {
    const req = http.request({ host: "127.0.0.1", port: site.port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode, headers: res.rawHeaders, body: Buffer.concat(chunks).toString("utf8"),
        error: res.headers["ludion-error"] ?? null, link: res.headers.link ?? null }));
    });
    req.on("error", no);
    req.end();
  });
}

/** Who each visitor must be classified as, or a decision naming it proves nothing. */
export const IDENTITY = {
  person: { class: "UNKNOWN", diverId: null, token: null },
  diver: { class: "VERIFIED", diverId: DIVER_ID, token: null },
  signer: { class: "VERIFIED", diverId: null, token: null },
  crawler: { class: "DECLARED", diverId: null, token: "GPTBot" },
  unnamed: { class: "SUSPECTED", diverId: null, token: null },
};

/** What a visitor's response says, in a word: ok, wall (the site's friction), or the Ludion-Error. */
export const outcome = (r) => (r.status === 200 ? "ok" : r.status === 429 && r.headers.includes("x-site-friction") ? "wall" : r.error ?? `HTTP ${r.status}`);

/**
 * The person's response, as GATE-1 compares it: every byte except the Gate's own `Ludion-*` headers
 * (its version and its receipt, which records the Pressure). Throws if the Gate did not run.
 */
export function personBytes(r) {
  const pairs = [];
  for (let i = 0; i < r.headers.length; i += 2) pairs.push([r.headers[i], r.headers[i + 1]]);
  if (!pairs.some(([k]) => /^ludion-receipt$/i.test(k))) throw new Error("no Ludion-Receipt: the Gate did not run");
  return JSON.stringify({ status: r.status, body: r.body, headers: pairs.filter(([k]) => !/^ludion-/i.test(k)) });
}

/** The site's existing friction (a CAPTCHA, a slow-down): what "wall" puts in front of a visitor. */
export const friction = (req, res) => { res.writeHead(429, { "x-site-friction": "1", "content-type": "text/plain" }); res.end("slow down\n"); };
