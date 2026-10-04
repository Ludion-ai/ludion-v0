// `npx ludion doctor` checks what the quickstart tells the reader it checks: the public files are
// reachable at the agent's origin, without a redirect, the directory with its media type
// (application/http-message-signatures-directory+json; many static hosts send an extensionless file as
// application/octet-stream), holding the current session key, and the card and client documents each
// naming their own URL. The origin is https://agent.test; a preload sends this process's fetch for
// that origin to a local static host, and nothing else.
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
    res.writeHead(x.status, { "content-type": x.type, ...(x.location ? { location: x.location } : {}) }).end(x.body);
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
