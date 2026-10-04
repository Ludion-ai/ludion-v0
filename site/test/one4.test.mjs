// ONE-4 (+): an agent the Gate stops gets Ludion-Error and a help link, and from the help page reaches
// VERIFIED with `npx ludion init` in three minutes (spec §9.3) — in a new environment, three times.
//
// The site runs the real gate-node middleware with /checkout at Pressure 2. An unsigned agent asks
// for it and is refused; the clock starts there. The agent follows the Link header to the page it
// names — the built site's own page — and does what its "Get verified" steps say, as written:
//   - `npx ludion …` is the packed `ludion` tarball (as npx would fetch it), into an empty directory
//     with an empty npm cache: a new environment each run;
//   - "publish the public files it wrote at your Signature-Agent origin": the files init wrote are
//     put where the Gate's key discovery finds that origin (the Gate never sees the agent's disk);
//   - the `sign … --curl` line, with the page's example URL replaced by the one it was stopped at;
//     the curl it prints is run as printed.
// The clock stops when that request gets through with a receipt that says VERIFIED. `doctor` is the
// page's optional self-check of the public origin, which a test machine cannot be; it is not run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildSite } from "../build.mjs";
import { ROOT, packAll, SET, manifest } from "../../accept/publish/set.mjs";
import { ludionGate } from "@ludion/gate-node";
import { generateSiteKey } from "@ludion/gate-core";

const LIMIT_S = 180, RUNS = 3;
const PASSPHRASE = "one-4 three minutes passphrase";
let dist, tarball, tmp, server, port, docroot;

const decode = (s) => s.replace(/&#x22;/g, '"').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The commands of a help page's "Get verified" section, in order, as the page's copy buttons hold them. */
export function verifySteps(html) {
  const at = html.search(/<h2 id="get-verified[^"]*"/);
  if (at < 0) return [];
  const end = html.indexOf("<h2", at + 4);
  return [...html.slice(at, end < 0 ? undefined : end).matchAll(/data-code="([^"]*)"/g)].map((m) => decode(m[1]));
}

function bash() {
  if (process.platform !== "win32") return "bash";
  for (const p of [process.env.LUDION_BASH, "C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) if (p && fs.existsSync(p)) return p;
  throw new Error("ONE-4 runs the page's commands with bash: install Git for Windows or set LUDION_BASH");
}
/** Run a shell line without blocking this process: the site that answers it runs here too. */
const sh = (code, cwd, env) => new Promise((resolve) => {
  const p = spawn(bash(), ["-c", code], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
  const t = setTimeout(() => p.kill(), 300_000);
  p.on("close", (code) => { clearTimeout(t); resolve({ out, err, code }); });
});

before(async () => {
  dist = buildSite();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-one4-"));
  fs.mkdirSync(path.join(tmp, "tgz"));
  const files = packAll(path.join(tmp, "tgz"));
  tarball = files[SET.findIndex((d) => manifest(d).name === "ludion")];
  docroot = path.join(tmp, "origins");
  // Key discovery: an agent origin's files are whatever the agent published there.
  const fetch = async (url) => {
    const u = new URL(url), file = path.join(docroot, u.hostname, u.pathname);
    if (u.protocol !== "https:" || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("", { status: 404 });
    const type = u.pathname.endsWith("http-message-signatures-directory") ? "application/http-message-signatures-directory+json" : "application/json";
    return new Response(fs.readFileSync(file), { status: 200, headers: { "content-type": type } });
  };
  server = http.createServer((req, res) => mw(req, res, () => { res.writeHead(200, { "content-type": "text/plain" }); res.end("order page\n"); }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  const mw = await ludionGate({ siteId: "site-one4", siteKey: (await generateSiteKey()).privateJwk, authorities: [`127.0.0.1:${port}`],
    routes: [{ match: "/checkout/**", pressure: 2 }], resolver: { fetch }, announce: () => {} });
}, { timeout: 900_000 });
after(() => { server?.close(); server?.closeAllConnections?.(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch {} });

const receiptOf = (head) => {
  const r = /^ludion-receipt: *(\S+)/im.exec(head)?.[1];
  return r ? JSON.parse(Buffer.from(r, "base64url").toString("utf8")) : null;
};

/** One run, from the refusal to VERIFIED. */
async function run(i) {
  const target = `http://127.0.0.1:${port}/checkout/1`;
  const agent = path.join(tmp, `agent-${i}`);
  fs.mkdirSync(agent);
  const env = { ...process.env, npm_config_cache: path.join(tmp, `npm-cache-${i}`), npm_config_yes: "true", npm_config_update_notifier: "false",
    npm_config_fund: "false", npm_config_audit: "false", LUDION_ROOT_PASSPHRASE: PASSPHRASE, NO_COLOR: "1" };
  for (const k of Object.keys(env)) if (/^(npm_package_|npm_lifecycle_|NODE_TEST_CONTEXT$)/.test(k)) delete env[k];
  const steps = {};
  const t0 = performance.now();
  // Stopped.
  const refused = (await sh(`curl -s -D - -o /dev/null ${target}`, agent, env)).out; // curl/…: automation that names no one
  assert.match(refused, /^HTTP\/1\.1 401/m, refused);
  const error = /^ludion-error: *(\S+)/im.exec(refused)?.[1];
  const link = /^link: *<([^>]+)>; *rel="help"/im.exec(refused)?.[1];
  assert.equal(error, "signature_required");
  assert.equal(link, "https://ludion.ai/e/signature_required");
  // The help page it names, from the site as built.
  const page = path.join(dist, `${new URL(link).pathname.replace(/^\//, "")}.html`);
  assert.ok(fs.existsSync(page), `the help page ${link} exists in the built site`);
  const cmds = verifySteps(fs.readFileSync(page, "utf8"));
  const init = cmds.find((c) => /^npx ludion init /.test(c)), sign = cmds.find((c) => /^npx ludion sign /.test(c));
  assert.ok(init && sign, `the page's steps: ${cmds.join(" | ")}`);
  // npx fetches ludion: here, the packed tarball into the new environment.
  fs.writeFileSync(path.join(agent, "package.json"), JSON.stringify({ name: `one4-agent-${i}`, private: true }));
  let t = performance.now();
  const inst = await sh(`npm install --no-package-lock "${tarball.replace(/\\/g, "/")}"`, agent, env);
  assert.equal(inst.code, 0, inst.err.slice(-1500));
  steps.npx = (performance.now() - t) / 1000;
  t = performance.now();
  const r1 = await sh(init, agent, env);
  assert.equal(r1.code, 0, `${init}: ${r1.err}`);
  steps.init = (performance.now() - t) / 1000;
  // Publish the public files at the Signature-Agent origin.
  const store = JSON.parse(fs.readFileSync(path.join(agent, "ludion.json"), "utf8"));
  const host = new URL(store.signature_agent).hostname;
  for (const f of [".well-known/http-message-signatures-directory", "card"]) {
    fs.mkdirSync(path.dirname(path.join(docroot, host, f)), { recursive: true });
    fs.copyFileSync(path.join(agent, f), path.join(docroot, host, f));
  }
  // Sign the request it was stopped at, and send the curl the CLI prints.
  t = performance.now();
  const r2 = await sh(sign.replace(/https:\/\/shop\.example\/\S+/, target), agent, env);
  assert.equal(r2.code, 0, r2.err);
  const curl = r2.out.split("\n#")[0].trim();
  assert.match(curl, /^curl /);
  const head = (await sh(curl.replace(/^curl /, "curl -s -D - -o /dev/null "), agent, env)).out;
  steps.sign = (performance.now() - t) / 1000;
  const s = (performance.now() - t0) / 1000;
  const receipt = receiptOf(head);
  return { s, steps, status: Number(/^HTTP\/1\.1 (\d+)/m.exec(head)?.[1]), receipt, identifier: store.signature_agent, head };
}

test("ONE-4: the judge reads the commands of a help page's Get verified section, in order (planted page)", () => {
  const html = '<h2 id="what-happened">x</h2><button data-code="npx ludion scan"></button><h2 id="get-verified-in-3-minutes">G</h2>'
    + '<button data-code="npx ludion init --name &#x22;A&#x22;"></button><button data-code="npx ludion sign GET https://shop.example/x --curl"></button><h2 id="next">n</h2><button data-code="rm -rf /"></button>';
  assert.deepEqual(verifySteps(html), ['npx ludion init --name "A"', "npx ludion sign GET https://shop.example/x --curl"]);
  assert.deepEqual(verifySteps("<h2 id=\"what-happened\">x</h2>"), [], "a page without the section has no steps");
});

test(`ONE-4: stopped (Ludion-Error, help link) → the help page's steps → VERIFIED in ≤ ${LIMIT_S} s, in a new environment, ${RUNS} times`, { timeout: 1_500_000 }, async () => {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await run(i));
  for (const r of runs) {
    assert.equal(r.status, 200, r.head);
    assert.equal(r.receipt?.class, "VERIFIED", r.head);
    assert.equal(r.receipt?.decision, "allow");
    assert.ok(r.s <= LIMIT_S, `${r.s.toFixed(1)} s > ${LIMIT_S} s`);
  }
  console.log(`ONE-4: refused → help page → init → publish → sign → VERIFIED in ${runs.map((r) => r.s.toFixed(1)).join(" / ")} s (limit ${LIMIT_S} s); npx ${runs.map((r) => r.steps.npx.toFixed(1)).join("/")} s, init ${runs.map((r) => r.steps.init.toFixed(1)).join("/")} s`);
});
