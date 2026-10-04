// WEB-13 (±): the "Sign from code" page (/agent, /ja/agent) does what it says. Its blocks are read in
// order, in both languages (the code must be the same in each): `npm install ludion` is the publish
// set's tarball, a block with a title is written as the file it names, a `sh` block is run in the
// agent's directory, and a `text` block is what the command before it must print.
//
// What stands in for the world, and nothing else:
//   - "After npx ludion init": the quickstart's own init line, run first, as the page says.
//   - http://localhost:3000/ — "the site from the quickstart, once your key directory is published" —
//     is a Gate (gate-node) on a free port whose key discovery finds the files init wrote.
//   - token.mjs is a fragment: the authorization step gives it `tokenEndpoint`, `code`, `redirectUri`
//     and `codeVerifier` (the prose says where each comes from). The token endpoint is a stub that
//     takes the exchange only if it is the one MCP-1 sends Keycloak (accept/mcp/flow.mjs) and the
//     assertion is the client's: iss = sub = client_id = the agent's name + /client, aud = the token
//     endpoint, short-lived, signed by a key in the agent's directory.
// The other side: planted pages — the old package name, a different printed result, a note that
// names a person, an assertion for another audience, an exchange without the assertion type, a page
// in one language only — are each caught.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { ludionGate } from "@ludion/gate-node";
import { generateSiteKey } from "@ludion/gate-core";
import { ROOT, packAll, SET, manifest } from "../../accept/publish/set.mjs";

const PAGES = { en: "site/src/content/docs/agent.mdx", ja: "site/src/content/docs/ja/agent.mdx" };
const QUICKSTART = "site/src/content/docs/quickstart.mdx";
const PASSPHRASE = "web-13 sign from code passphrase";
// The token request MCP-1 sends Keycloak (accept/mcp/flow.mjs): the page must send the same fields.
const TOKEN_FIELDS = ["grant_type", "code", "redirect_uri", "code_verifier", "client_id", "client_assertion_type", "client_assertion"];
const JWT_BEARER = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** The page's fenced blocks in order. */
export function blocks(mdx) {
  return [...mdx.replace(/\r\n/g, "\n").matchAll(/^```(\w+)(?: title="([^"]+)")?\n([\s\S]*?)^```[ \t]*$/gm)].map((m) => ({ lang: m[1], title: m[2] ?? null, code: m[3] }));
}
const printsAsShown = (actual, shown) => actual.replace(/\r\n/g, "\n").trim() === shown.trim();

let tmp, agent, env, site, sitePort, tokenStub, tokenPort, store, tokenSeen;
const posix = (p) => p.replace(/\\/g, "/");

function bash() {
  if (process.platform !== "win32") return "bash";
  for (const p of [process.env.LUDION_BASH, "C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) if (p && fs.existsSync(p)) return p;
  throw new Error("WEB-13 runs the page's shell blocks with bash: install Git for Windows or set LUDION_BASH");
}
/** A shell line, run without blocking this process (the site and the token endpoint answer it from here). */
const sh = (code, cwd, extra = {}) => new Promise((resolve) => {
  const p = spawn(bash(), ["-c", code], { cwd, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
  const t = setTimeout(() => p.kill(), 300_000);
  p.on("close", (c) => { clearTimeout(t); resolve({ out, err, code: c }); });
});

/** The token endpoint: answers only the exchange MCP-1 makes, with this agent's assertion. */
async function tokenProblems(form) {
  const out = [];
  const keys = [...form.keys()].sort(), want = [...TOKEN_FIELDS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(want)) out.push(`fields ${keys.join(",")} (MCP-1 sends ${want.join(",")})`);
  const clientId = `${store.signature_agent}/client`;
  if (form.get("client_id") !== clientId) out.push(`client_id ${form.get("client_id")}`);
  if (form.get("client_assertion_type") !== JWT_BEARER) out.push(`client_assertion_type ${form.get("client_assertion_type")}`);
  for (const [k, v] of [["grant_type", "authorization_code"], ["code", "the-code"], ["redirect_uri", "http://127.0.0.1:53682/callback"], ["code_verifier", "the-verifier"]]) if (form.get(k) !== v) out.push(`${k} ${form.get(k)}`);
  const jwt = form.get("client_assertion") ?? "";
  const [h, p, s] = jwt.split(".");
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")), claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    const dir = JSON.parse(fs.readFileSync(path.join(agent, ".well-known", "http-message-signatures-directory"), "utf8"));
    const jwk = dir.keys.find((k) => k.kid === header.kid);
    if (header.alg !== "EdDSA" || !jwk) out.push(`assertion header ${JSON.stringify(header)}: not EdDSA by a key in the agent's directory`);
    else {
      const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
      if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`)))) out.push("the assertion's signature does not verify");
    }
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== clientId || claims.sub !== clientId) out.push(`iss/sub ${claims.iss} ${claims.sub}`);
    if (claims.aud !== `http://127.0.0.1:${tokenPort}/token` && !(Array.isArray(claims.aud) && claims.aud.includes(`http://127.0.0.1:${tokenPort}/token`))) out.push(`aud ${JSON.stringify(claims.aud)}`);
    if (!(claims.exp > now && claims.exp - now <= 300)) out.push(`exp ${claims.exp} (now ${now})`);
    if (!claims.jti) out.push("no jti");
  } catch (e) { out.push(`an assertion that cannot be read: ${e.message}`); }
  return out;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-web13-"));
  fs.mkdirSync(path.join(tmp, "tgz"));
  const files = packAll(path.join(tmp, "tgz"));
  const tarball = files[SET.findIndex((d) => manifest(d).name === "ludion")];
  env = { ...process.env, npm_config_cache: path.join(tmp, "npm-cache"), npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false",
    npm_config_yes: "true", NO_COLOR: "1", LUDION_TARBALL: posix(tarball) };
  for (const k of Object.keys(env)) if (/^(npm_package_|npm_lifecycle_|NODE_TEST_CONTEXT$)/.test(k)) delete env[k];
  agent = path.join(tmp, "agent");
  fs.mkdirSync(agent);
  fs.writeFileSync(path.join(agent, "package.json"), JSON.stringify({ name: "web13-agent", private: true }));
  const inst = await sh(`npm install --no-package-lock "${posix(tarball)}"`, agent);
  assert.equal(inst.code, 0, inst.err.slice(-1500));
  // "After npx ludion init": the quickstart's line.
  const init = blocks(fs.readFileSync(path.join(ROOT, QUICKSTART), "utf8")).find((b) => b.lang === "sh" && /^npx ludion init /.test(b.code.trim()));
  assert.ok(init, "the quickstart's init line");
  const r = await sh(init.code.trim(), agent, { LUDION_ROOT_PASSPHRASE: PASSPHRASE });
  assert.equal(r.code, 0, r.err);
  store = JSON.parse(fs.readFileSync(path.join(agent, "ludion.json"), "utf8"));

  // The quickstart's site, with the directory published at the agent's origin.
  const fetchDirectory = async (url) => {
    const u = new URL(url);
    const file = path.join(agent, u.pathname);
    if (u.origin !== store.signature_agent || u.pathname !== "/.well-known/http-message-signatures-directory") return new Response("", { status: 404 });
    return new Response(fs.readFileSync(file), { status: 200, headers: { "content-type": "application/http-message-signatures-directory+json" } });
  };
  const mw = await ludionGate({ siteId: "site-my-shop", siteKey: (await generateSiteKey()).privateJwk, resolver: { fetch: fetchDirectory }, announce: () => {} });
  site = http.createServer((req, res) => mw(req, res, () => res.end("Hello from my shop\n")));
  await new Promise((ok) => site.listen(0, "127.0.0.1", ok));
  sitePort = site.address().port;

  tokenStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", async () => {
      const problems = req.url === "/token" && req.method === "POST" ? await tokenProblems(new URLSearchParams(body)) : [`${req.method} ${req.url}`];
      tokenSeen.push(problems);
      res.writeHead(problems.length ? 400 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(problems.length ? { error: "invalid_client", error_description: problems.join("; ") } : { access_token: "t", token_type: "Bearer", expires_in: 300 }));
    });
  });
  await new Promise((ok) => tokenStub.listen(0, "127.0.0.1", ok));
  tokenPort = tokenStub.address().port;
}, { timeout: 900_000 });
after(() => {
  for (const s of [site, tokenStub]) { s?.closeAllConnections?.(); s?.close(); }
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch {}
});

/** Run the page's blocks in the agent's directory. @returns {Promise<{ problems: string[], checked: number }>} */
async function runPage(page) {
  const problems = [];
  let checked = 0;
  tokenSeen = [];
  const local = (code) => code.replaceAll("http://localhost:3000/", `http://localhost:${sitePort}/`);
  for (let i = 0; i < page.length; i++) {
    const b = page[i], next = page[i + 1];
    if (b.title === "token.mjs") {
      // A fragment: the authorization step gives it what it names.
      const given = `const tokenEndpoint = "http://127.0.0.1:${tokenPort}/token", code = "the-code", redirectUri = "http://127.0.0.1:53682/callback", codeVerifier = "the-verifier";\n`;
      fs.writeFileSync(path.join(agent, b.title), `${given}${b.code}\nprocess.stdout.write(String(token.token_type));\n`);
      const r = await sh(`node ${b.title}`, agent);
      if (r.code !== 0 || r.out.trim() !== "Bearer") problems.push(`token.mjs: exit ${r.code}, printed ${JSON.stringify(r.out)}; the token endpoint: ${JSON.stringify(tokenSeen)}; ${r.err.slice(-600)}`);
      else checked++;
      continue;
    }
    if (b.title) { fs.writeFileSync(path.join(agent, b.title), local(b.code)); continue; }
    if (b.lang === "text") continue; // read with the command before it
    if (b.lang !== "sh") { problems.push(`a block that is neither a file, a command nor its output: ${b.lang}`); continue; }
    const code = b.code.trim().replace(/^npm install ludion$/, `npm install --no-package-lock "$LUDION_TARBALL"`);
    const r = await sh(code, agent);
    if (r.code !== 0) { problems.push(`\`${b.code.trim()}\` failed (${r.code}): ${r.err.slice(-600)}`); continue; }
    if (next?.lang === "text") {
      if (!printsAsShown(r.out, next.code)) problems.push(`\`${b.code.trim()}\` printed ${JSON.stringify(r.out.trim())}, the page shows ${JSON.stringify(next.code.trim())}`);
      else checked++;
    }
  }
  return { problems, checked };
}

const read = (lang) => fs.readFileSync(path.join(ROOT, PAGES[lang]), "utf8");

test("WEB-13: /agent runs as written — signed (VERIFIED), with a purpose (read), and the MCP token exchange MCP-1 makes — and /ja/agent has the same code", { timeout: 600_000 }, async () => {
  const en = blocks(read("en")), ja = blocks(read("ja"));
  assert.deepEqual(ja, en, "the Japanese page's code is the English page's");
  // The page's token exchange is MCP-1's: each field is in the request accept/mcp/flow.mjs sends Keycloak.
  const flow = fs.readFileSync(path.join(ROOT, "accept/mcp/flow.mjs"), "utf8");
  for (const f of TOKEN_FIELDS) assert.match(flow, new RegExp(`\\b${f}:`), `MCP-1's token request sends ${f}`);
  const { problems, checked } = await runPage(en);
  assert.deepEqual(problems, []);
  assert.equal(checked, 3, "two printed results and the token exchange");
  console.log(`WEB-13: /agent (en = ja): ${en.length} blocks; agent.mjs → 200 VERIFIED, purpose.mjs → 200 read, token.mjs → a token for ${store.signature_agent}/client (the exchange MCP-1 makes)`);
});

test("WEB-13: planted pages are caught", { timeout: 600_000 }, async () => {
  const en = blocks(read("en"));
  const plant = (title, a, b) => en.map((x) => {
    if (x.title !== title && !(title === null && x.lang === "text")) return x;
    if (!x.code.includes(a)) return x;
    return { ...x, code: x.code.replace(a, b) };
  });
  const planted = [
    ["the old package name", plant("agent.mjs", 'from "ludion/diver"', 'from "@ludion/diver"'), /agent\.mjs` failed/],
    ["a different printed result", plant(null, "200 VERIFIED", "200 UNVERIFIED"), /printed "200 VERIFIED", the page shows "200 UNVERIFIED"/],
    ["a note that names a person", plant("purpose.mjs", "Compare prices for the user", "Compare prices for tanaka@example.com"), /purpose\.mjs` failed/],
    ["an assertion for another audience", plant("token.mjs", "audience: tokenEndpoint", "audience: clientId"), /token\.mjs: .*aud /],
    ["no assertion type", plant("token.mjs", '    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",\n', ""), /token\.mjs: .*fields /],
    ["another client_id", plant("token.mjs", "const clientId = `${me.signature_agent}/client`;", "const clientId = `${me.signature_agent}/card`;"), /token\.mjs: .*client_id /],
    ["another key's signature under this key's kid", plant("token.mjs", "clientAssertion(me.session, {", 'clientAssertion({ ...me.session, d: (await (await import("ludion/diver")).generateEd25519()).privateJwk.d }, {'), /token\.mjs: .*signature does not verify/],
  ];
  const missed = [];
  for (const [name, page, why] of planted) {
    if (JSON.stringify(page) === JSON.stringify(en)) { missed.push(`${name}: the plant changed nothing`); continue; }
    const { problems } = await runPage(page);
    if (!problems.some((p) => why.test(p))) missed.push(`${name}: ${problems.join(" | ") || "no problem found"}`);
  }
  const jaPlanted = blocks(read("ja").replace("console.log(res.status, receipt.class);", "console.log(receipt.class);"));
  if (JSON.stringify(jaPlanted) === JSON.stringify(en) || JSON.stringify(jaPlanted) === JSON.stringify(blocks(read("ja")))) missed.push("the Japanese page behind: the plant changed nothing");
  assert.deepEqual(missed, []);
  assert.notDeepEqual(jaPlanted, en, "a Japanese page whose code differs fails the equality above");
  console.log(`WEB-13 planted: ${planted.length + 1}/${planted.length + 1} caught`);
});
