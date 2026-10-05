// `npx ludion-ai doctor` checks what the quickstart tells the reader it checks: the public files are
// reachable at the agent's origin, without a redirect, the directory with its media type
// (application/http-message-signatures-directory+json; many static hosts send an extensionless file as
// application/octet-stream), holding the current session key, and the card and client documents each
// naming their own URL. The origin is https://agent.test; a preload sends this process's fetch for
// that origin to a local static host, and nothing else.
// DIV-7: the clock is checked against that origin's Date header (Gates allow ±30 s, spec §10.4).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../bin/ludion.mjs");
const HOST = "agent.test";
const PASSPHRASE = "doctor test passphrase";
let tmp, agent, server, port, shim;
let serve = () => null; // per test: (pathname) => { status, type, body, location } | null (as published)
let dateOf = () => undefined; // per test: the host's Date header (a string), none (null), or the host's own (undefined)

const run = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", shim, CLI, ...args], {
    cwd: agent, env: { ...process.env, LUDION_ROOT_PASSPHRASE: PASSPHRASE, DOCTOR_HOST: HOST, DOCTOR_TO: `http://127.0.0.1:${port}`, NO_COLOR: "1", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
  p.on("close", (code) => resolve({ code, out }));
});

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-doctor-"));
  agent = path.join(tmp, "agent");
  fs.mkdirSync(agent);
  shim = pathToFileURL(path.join(tmp, "shim.mjs")).href;
  fs.writeFileSync(path.join(tmp, "shim.mjs"), [
    "const host = process.env.DOCTOR_HOST, to = process.env.DOCTOR_TO, real = globalThis.fetch;",
    "globalThis.fetch = (input, init) => {",
    "  const u = new URL(input instanceof Request ? input.url : String(input));",
    "  return u.protocol === 'https:' && u.host === host ? real(to + u.pathname + u.search, init) : real(input, init);",
    "};",
  ].join("\n"));
  const r = spawnSync(process.execPath, [CLI, "init", "--name", "Doctor Test", "--contact", "mailto:ops@example.com", "--domain", HOST], {
    cwd: agent, encoding: "utf8", env: { ...process.env, LUDION_ROOT_PASSPHRASE: PASSPHRASE, CI: "1" }, timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  // A static host serving what init wrote, as published, unless the test says otherwise.
  const published = {
    "/.well-known/http-message-signatures-directory": { type: "application/http-message-signatures-directory+json", file: ".well-known/http-message-signatures-directory" },
    "/card": { type: "application/json", file: "card" },
    "/client": { type: "application/json", file: "client" },
  };
  server = http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    const x = serve(p) ?? (published[p] ? { status: 200, type: published[p].type, body: fs.readFileSync(path.join(agent, published[p].file)) } : { status: 404, type: "text/plain", body: "not found" });
    const date = dateOf();
    if (date === null) res.sendDate = false;
    res.writeHead(x.status, { "content-type": x.type, ...(x.location ? { location: x.location } : {}), ...(typeof date === "string" ? { date } : {}) }).end(x.body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => { server?.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

const json = (o) => ({ status: 200, type: "application/json", body: JSON.stringify(o) });
const file = (f) => JSON.parse(fs.readFileSync(path.join(agent, f), "utf8"));

test("doctor: the files as published — reachable, typed, the current key, each document naming its URL — are all good", async () => {
  serve = () => null;
  const r = await run(["doctor"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /All good/);
  for (const p of ["/.well-known/http-message-signatures-directory", "/card", "/client"]) assert.ok(r.out.includes(`✔ https://${HOST}${p}`), r.out);
});

test("doctor: a card or client document on your own domain that is not private_key_jwt — a public client, a secret, nothing said — is warned about", async () => {
  const cases = [
    ["a public client document", (p) => (p === "/client" ? json({ ...file("client"), token_endpoint_auth_method: "none" }) : null), /⚠ \/client says token_endpoint_auth_method "none".*a public client/],
    ["a card with a shared secret", (p) => (p === "/card" ? json({ ...file("card"), token_endpoint_auth_method: "client_secret_basic" }) : null), /⚠ \/card says token_endpoint_auth_method "client_secret_basic"/],
    ["a card that says nothing", (p) => { if (p !== "/card") return null; const { token_endpoint_auth_method, ...rest } = file("card"); return json(rest); }, /⚠ \/card says token_endpoint_auth_method null/],
  ];
  const missed = [];
  for (const [name, fault, why] of cases) {
    serve = fault;
    const r = await run(["doctor"]);
    if (r.code === 0 || !why.test(r.out) || /All good/.test(r.out)) missed.push(`${name}: exit ${r.code}\n${r.out}`);
  }
  serve = () => null;
  assert.deepEqual(missed, []);
});

test("doctor: a wrong type, a missing file, a redirect, a stale directory and a document naming another URL are each reported", async () => {
  const cases = [
    ["the directory as application/octet-stream", (p) => (p.startsWith("/.well-known") ? { status: 200, type: "application/octet-stream", body: fs.readFileSync(path.join(agent, ".well-known/http-message-signatures-directory")) } : null), /served with application\/octet-stream/],
    ["no /client", (p) => (p === "/client" ? { status: 404, type: "text/plain", body: "" } : null), /\/client returned 404/],
    ["the card behind a redirect", (p) => (p === "/card" ? { status: 301, type: "text/plain", body: "", location: "https://elsewhere.test/card" } : null), /\/card returned 301 \(must be 200, no redirect\)/],
    ["a directory without the current session key", (p) => (p.startsWith("/.well-known") ? { ...json({ keys: [] }), type: "application/http-message-signatures-directory+json" } : null), /does not contain the current session key/],
    ["a client document naming another URL", (p) => (p === "/client" ? json({ ...file("client"), client_id: `https://${HOST}/card` }) : null), /client client_id must equal its URL/],
  ];
  const missed = [];
  for (const [name, fault, why] of cases) {
    serve = fault;
    const r = await run(["doctor"]);
    if (r.code === 0 || !why.test(r.out)) missed.push(`${name}: exit ${r.code}\n${r.out}`);
  }
  serve = () => null;
  assert.deepEqual(missed, []);
});

const offBy = (s) => () => new Date(Date.now() + s * 1000).toUTCString();

test("DIV-7: a clock in step with the agent's origin, or 20 s off, passes; no Date header to compare with is said, not failed", async () => {
  serve = () => null;
  const missed = [];
  for (const [name, date, why] of [
    ["in step", offBy(0), /✔ clock: within \d+ s of agent\.test/],
    ["20 s ahead", offBy(-20), /✔ clock: within \d+ s of agent\.test/],
    ["20 s behind", offBy(20), /✔ clock: within \d+ s of agent\.test/],
    ["no Date header", () => null, /\? clock: local time .* agent\.test sent no Date header/],
  ]) {
    dateOf = date;
    const r = await run(["doctor"]);
    if (r.code !== 0 || !why.test(r.out) || !/All good/.test(r.out)) missed.push(`${name}: exit ${r.code}\n${r.out}`);
  }
  dateOf = () => undefined;
  assert.deepEqual(missed, []);
  console.log("DIV-7: a clock in step, 20 s ahead or behind passes; no Date header is said, not failed");
});

test("DIV-7: a clock more than 30 s off the agent's origin — ahead or behind — is a problem that says by how much and how to sync", async () => {
  serve = () => null;
  const missed = [];
  for (const [name, off, why] of [
    ["5 minutes ahead", -300, /✖ clock: this machine is 30\d s ahead of agent\.test; Gates refuse signatures more than 30 s off/],
    ["5 minutes behind", 300, /✖ clock: this machine is 30\d s behind agent\.test/],
    ["45 s behind", 45, /✖ clock: this machine is 4\d s behind agent\.test/],
    ["a day ahead", -86_400, /✖ clock: this machine is 864\d\d s ahead of agent\.test/],
  ]) {
    dateOf = offBy(off);
    const r = await run(["doctor"]);
    if (r.code === 0 || !why.test(r.out) || /All good/.test(r.out) || !/w32tm \/resync/.test(r.out)) missed.push(`${name}: exit ${r.code}\n${r.out}`);
  }
  dateOf = () => undefined;
  assert.deepEqual(missed, []);
  console.log("DIV-7: 4 skewed clocks (5 min and 45 s behind, 5 min and a day ahead) each a problem with the skew and the fix");
});

test("DIV-7: when the Registry refuses a Root statement as stale, the CLI points at this machine's clock and doctor", async () => {
  // A Registry that answers every statement as stale (as the real one does past ±5 minutes).
  const stale = http.createServer((req, res) => { req.resume(); res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "stale_statement", detail: "statement iat is missing or not within 5 minutes of now" })); });
  await new Promise((r) => stale.listen(0, "127.0.0.1", r));
  // Any other refusal says nothing about the clock.
  const other = http.createServer((req, res) => { req.resume(); res.writeHead(429, { "content-type": "application/json", "retry-after": "60" }).end(JSON.stringify({ error: "rate_limited" })); });
  await new Promise((r) => other.listen(0, "127.0.0.1", r));
  try {
    const r = await run(["register", "--registry", `http://127.0.0.1:${stale.address().port}`]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /stale_statement/);
    assert.match(r.out, /clock may be off: \`npx ludion-ai doctor\`/, r.out);
    const o = await run(["register", "--registry", `http://127.0.0.1:${other.address().port}`]);
    assert.notEqual(o.code, 0, o.out);
    assert.doesNotMatch(o.out, /clock/, o.out);
  } finally { stale.close(); other.close(); }
  console.log("DIV-7: a stale-statement refusal points at the clock and doctor; another refusal does not");
});

test("doctor: a Card Host's refusal says what to do — not registered yet (register), or the Registry unavailable (try again); any other 404 says nothing more", async () => {
  const missed = [];
  for (const [name, x, why, not] of [
    ["unknown to the Card Host", { status: 404, type: "application/json", body: JSON.stringify({ error: "unknown_agent" }) }, /\/card returned 404 \(must be 200, no redirect\) — the Card Host does not know this agent: not registered yet \(run `npx ludion-ai register`\), or revoked/],
    ["the Registry unavailable", { status: 503, type: "application/json", body: JSON.stringify({ error: "registry_unavailable" }) }, /\/card returned 503 \(must be 200, no redirect\) — the Registry is unavailable right now; try again in a minute/],
    ["a plain 404", { status: 404, type: "text/plain", body: "not found" }, /\/card returned 404 \(must be 200, no redirect\)\n/, /register|unavailable/],
  ]) {
    serve = (p) => (p === "/card" ? x : null);
    const r = await run(["doctor"]);
    if (r.code === 0 || !why.test(r.out) || (not && not.test(r.out))) missed.push(`${name}: exit ${r.code}\n${r.out}`);
  }
  serve = () => null;
  assert.deepEqual(missed, []);
});
