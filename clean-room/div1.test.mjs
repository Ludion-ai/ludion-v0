// DIV-1 (docs/MISSION.md §4): three minutes. From a clean environment, with only the packed
// artifacts: init → publish the Card (a local Card Host) → sign → a Gate says VERIFIED, in ≤180 s,
// for TypeScript/JS and for Python.
//
// Untimed build: `npm pack` of the one package on npm (`ludion`, ADR-036), and the Python wheel built from
// python/ with a hash-pinned backend (clean-room/build.lock). Neither is published anywhere.
//
// Timed, per language, from a cold start of the environment to the Gate's VERIFIED:
//   container (Linux CI, required there): docker run of an image pinned by digest, the artifacts
//     mounted read-only, host networking to reach the Gate. The image pull is not timed.
//   fallback (no Docker, or not Linux): the same agent script in a fresh temp dir, with an empty
//     npm cache and config, a fresh virtualenv, and the monorepo's npm_/NODE_/LUDION_ environment
//     stripped. The metric says which one ran.
//
// The Gate is the real gate-node middleware on a real HTTP server (Pressure 0, the site's own
// authority pinned). Key discovery goes to the local Card Host with the Host header kept; TLS is
// not exercised (as in DIV-2). Both agents sign with type=cimd, so the Card is what resolves.
//
// DIV-3's rules hold in the clean room too: the Root is sealed in ludion.json (opened here with the
// passphrase, by the JS keystore code, whichever language wrote it), it is not in any directory,
// and no file the agent wrote holds the Root seed in any encoding.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ludionGate } from "@ludion/gate-node";
import { generateSiteKey } from "@ludion/gate-core";
import { openRootKey, isSealedRoot } from "@ludion/diver";
import { createCardHost, nodeListener } from "@ludion/card-host";
import { ensureVenv, findPython } from "../interop/python.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LIMIT_S = 180;
const PASSPHRASE = "div1 correct horse battery staple";
const IMAGES = {
  ts: "node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c",
  py: "python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e",
};
const PACKAGES = ["packages/ludion"]; // the one package on npm (ADR-036): the CLI, ludion-ai/diver, the Gate
const WIN = process.platform === "win32";

function dockerWorks() {
  try { execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }); return true; }
  catch { return false; }
}
const CONTAINER_REQUIRED = process.env.CI === "true" && process.platform === "linux";
const MODE = process.platform === "linux" && dockerWorks() ? "container" : "fallback";

// ── untimed build ──────────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-div1-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
const pkgs = path.join(tmp, "pkgs"), room = path.join(tmp, "clean-room");
fs.mkdirSync(pkgs); fs.mkdirSync(room);
const build = Promise.resolve().then(() => {
  execFileSync("npm", ["pack", "--silent", "--pack-destination", pkgs, ...PACKAGES.flatMap((p) => ["--workspace", p])], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: WIN, timeout: 120_000 });
  const builder = ensureVenv(path.join(HERE, "build.lock"));
  execFileSync(builder, ["-m", "pip", "wheel", "--disable-pip-version-check", "--no-deps", "--no-build-isolation", "--no-index", "-w", pkgs, path.join(ROOT, "python")], { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
  for (const f of ["agent-ts.mjs", "agent-py.py"]) fs.copyFileSync(path.join(HERE, f), path.join(room, f));
  fs.copyFileSync(path.join(ROOT, "interop", "py", "requirements.lock"), path.join(room, "requirements.lock"));
  const files = fs.readdirSync(pkgs);
  assert.equal(files.filter((f) => f.endsWith(".tgz")).length, PACKAGES.length, `packed: ${files}`);
  assert.ok(files.some((f) => /^ludion-0\.0\.1-py3-none-any\.whl$/.test(f)), `wheel: ${files}`);
  return files;
});
build.catch(() => {});

// ── the site: a local Card Host and a real Gate ─────────────────────────────────────────
const workOf = (lang) => path.join(tmp, lang);
function publishedFor(host) {
  for (const lang of ["ts", "py"]) {
    try {
      const dir = path.join(workOf(lang), "published");
      const card = JSON.parse(fs.readFileSync(path.join(dir, "card"), "utf8"));
      if (new URL(card.client_id).hostname === host) return { card, directory: JSON.parse(fs.readFileSync(path.join(dir, ".well-known", "http-message-signatures-directory"), "utf8")) };
    } catch { /* not published (yet) */ }
  }
  return undefined;
}
const cardHost = http.createServer(nodeListener(createCardHost({ lookup: publishedFor, maxAgeS: 60 })));
await new Promise((r) => cardHost.listen(0, "127.0.0.1", r));
after(() => cardHost.close());
const discovery = [];
function localFetch(input, init = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(String(input));
    const req = http.request({ host: "127.0.0.1", port: cardHost.address().port, path: u.pathname + u.search, method: init.method ?? "GET",
      headers: { ...Object.fromEntries(new Headers(init.headers ?? {})), host: u.host } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { discovery.push({ url: u.href, status: res.statusCode }); resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: Object.entries(res.headers).map(([k, v]) => [k, String(v)]) })); });
    });
    init.signal?.addEventListener("abort", () => req.destroy(new Error("aborted")));
    req.on("error", reject);
    req.end();
  });
}
let self;
const siteKey = await generateSiteKey();
const gateMw = await ludionGate({ siteId: "site-div1", siteKey: siteKey.privateJwk, pressure: 0, authorities: (a) => a === self, resolver: { fetch: localFetch } });
const site = http.createServer((req, res) => gateMw(req, res, () => {
  const c = req.ludion.cls;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ class: c.class, identifier: c.identifier, reason: c.reason, detail: c.detail }));
}));
await new Promise((r) => site.listen(0, "127.0.0.1", r));
after(() => site.close());
self = `127.0.0.1:${site.address().port}`;
const GATE = `http://${self}`;

// ── running an agent ─────────────────────────────────────────────────────────────────────
function cleanEnv(home) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(npm_|NODE_|LUDION_|PIP_|PYTHON|VIRTUAL_ENV)/i.test(k)) env[k] = v;
  for (const d of ["home", "appdata", "localappdata", "cache"]) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.writeFileSync(path.join(home, ".npmrc"), "");
  return { ...env, HOME: path.join(home, "home"), USERPROFILE: path.join(home, "home"), APPDATA: path.join(home, "appdata"), LOCALAPPDATA: path.join(home, "localappdata"),
    XDG_CACHE_HOME: path.join(home, "cache"), npm_config_cache: path.join(home, "cache", "npm"), npm_config_userconfig: path.join(home, ".npmrc"),
    npm_config_update_notifier: "false", PIP_CONFIG_FILE: os.devnull, PIP_NO_CACHE_DIR: "1", PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1",
    LUDION_ROOT_PASSPHRASE: PASSPHRASE };
}

function spawnJson(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    const out = [], err = [];
    const timer = setTimeout(() => p.kill("SIGKILL"), (LIMIT_S + 60) * 1000);
    p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", (c) => err.push(c));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      const wall = (performance.now() - t0) / 1000;
      const text = Buffer.concat(out).toString("utf8").trim();
      let json;
      try { json = JSON.parse(text.split("\n").pop()); } catch { json = { ok: false, why: `no JSON (exit ${code})`, stdout: text.slice(-500) }; }
      resolve({ code, wall, json, stderr: Buffer.concat(err).toString("utf8").slice(-1500) });
    });
  });
}

async function runAgent(lang) {
  const work = workOf(lang);
  fs.mkdirSync(work, { recursive: true });
  if (MODE === "container") {
    execFileSync("docker", ["pull", "--quiet", IMAGES[lang]], { stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 }); // not timed
    fs.mkdirSync(path.join(work, ".home"), { recursive: true }); // HOME for an image user with no passwd entry
    const user = `${process.getuid()}:${process.getgid()}`;
    const common = ["run", "--rm", "--network", "host", "--user", user, "-w", "/work",
      "-v", `${work}:/work`, "-v", `${pkgs}:/pkgs:ro`, "-v", `${room}:/clean-room:ro`,
      "-e", "HOME=/work/.home", "-e", `LUDION_ROOT_PASSPHRASE=${PASSPHRASE}`, "-e", "PYTHONDONTWRITEBYTECODE=1",
      "-e", "npm_config_cache=/work/.home/npm", "-e", "npm_config_update_notifier=false"];
    const cmd = lang === "ts" ? ["node", "/clean-room/agent-ts.mjs", "--gate", GATE, "--pkgs", "/pkgs"]
      : ["python", "/clean-room/agent-py.py", "--gate", GATE, "--pkgs", "/pkgs", "--lock", "/clean-room/requirements.lock"];
    return { ...await spawnJson("docker", [...common, IMAGES[lang], ...cmd], {}), where: `container ${IMAGES[lang].split("@")[0]}` };
  }
  const env = cleanEnv(path.join(tmp, `${lang}-env`));
  if (lang === "ts") return { ...await spawnJson(process.execPath, [path.join(room, "agent-ts.mjs"), "--gate", GATE, "--pkgs", pkgs], { cwd: work, env }), where: "fallback (not containerised)" };
  const py = findPython();
  return { ...await spawnJson(py.cmd, [...py.args, path.join(room, "agent-py.py"), "--gate", GATE, "--pkgs", pkgs, "--lock", path.join(room, "requirements.lock")], { cwd: work, env }),
    where: `fallback (not containerised, Python ${py.version})` };
}

/** Every file the agent wrote (dependencies and caches excluded), for the Root-seed scan. */
function writtenFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "venv", ".home"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) writtenFiles(p, out); else out.push(p);
  }
  return out;
}

async function check(lang, t) {
  assert.ok(!(CONTAINER_REQUIRED && MODE !== "container"), "Linux CI must run DIV-1 in a clean container (docker unavailable)");
  await build;
  const r = await runAgent(lang);
  assert.equal(r.code, 0, `${lang} agent failed: ${JSON.stringify(r.json).slice(0, 1500)} ${r.stderr}`);
  assert.equal(r.json.ok, true);
  const { steps, responses, store } = r.json;
  t.diagnostic(`div1 ${lang}: ${r.wall.toFixed(1)}s ${r.where} — install ${steps.install}s, init ${steps.init}s, publish ${steps.publish}s, sign→VERIFIED ${steps.first_verified}s`);
  assert.ok(r.wall <= LIMIT_S, `${lang}: ${r.wall.toFixed(1)}s > ${LIMIT_S}s`);

  // VERIFIED through the Card the agent published
  const cardUrl = `${store.signature_agent}/card`;
  assert.equal(responses.length, 2);
  for (const x of responses) {
    assert.equal(x.status, 200, `${x.method}: ${JSON.stringify(x.body)}`);
    assert.equal(x.body.class, "VERIFIED", `${x.method}: ${JSON.stringify(x.body)}`);
    assert.equal(x.body.identifier, cardUrl, `${x.method}: identified by the published card`);
  }
  assert.ok(discovery.some((d) => d.url === cardUrl && d.status === 200), "the Gate fetched the card");
  assert.ok(discovery.some((d) => d.url === `${store.signature_agent}/.well-known/http-message-signatures-directory` && d.status === 200), "and its jwks_uri");

  // DIV-3 in the clean room: sealed, never in a directory, never on disk in any encoding
  const work = workOf(lang);
  const stored = JSON.parse(fs.readFileSync(path.join(work, "ludion.json"), "utf8"));
  assert.ok(isSealedRoot(stored.root), `${lang}: the Root is sealed in ludion.json`);
  const opened = await openRootKey(stored.root, PASSPHRASE); // the JS keystore opens what either language sealed
  assert.equal(opened.kid, stored.root.kid);
  for (const f of [path.join(work, ".well-known", "http-message-signatures-directory"), path.join(work, "published", ".well-known", "http-message-signatures-directory")]) {
    const dir = JSON.parse(fs.readFileSync(f, "utf8"));
    assert.ok(!dir.keys.some((k) => k.kid === stored.root.kid || k.x === stored.root.x), `${lang}: Root not in ${path.relative(work, f)}`);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(work, "card"), "utf8")).ludion?.root_kid, stored.root.kid);
  const seed = Buffer.from(opened.d, "base64url");
  const needles = [seed.toString("base64url"), seed.toString("base64"), seed.toString("base64").replace(/=+$/, ""), seed.toString("hex"), seed.toString("hex").toUpperCase()];
  const leaks = writtenFiles(work).filter((f) => { const s = fs.readFileSync(f).toString("latin1"); return needles.some((n) => s.includes(n)); });
  assert.deepEqual(leaks.map((f) => path.relative(work, f)), [], `${lang}: files holding the Root seed`);
}

// Found by DIV-1's first run on a Japanese Windows console: `python -m ludion init` crashed while
// printing "✔" to a cp932 stdout (UnicodeEncodeError), and the library's "⚠" warnings would crash
// an agent's own process the same way. Pinned here, fast, before the clean-room runs.
test("DIV-1: the Python Diver works on a console that cannot print its symbols (cp932, ascii)", async () => {
  await build;
  const wheel = path.join(pkgs, fs.readdirSync(pkgs).find((f) => f.endsWith(".whl")));
  const vpy = ensureVenv(path.join(ROOT, "interop", "py", "requirements.lock"), { extra: [wheel] });
  for (const encoding of ["cp932", "ascii"]) {
    const dir = fs.mkdtempSync(path.join(tmp, `enc-${encoding}-`));
    const env = { ...process.env, PYTHONIOENCODING: encoding, PYTHONUTF8: "0" };
    delete env.LUDION_ROOT_PASSPHRASE; delete env.LUDION_DEV;
    for (const args of [["init", "--dev", "--name", "Enc Agent"], ["sign", "GET", "https://shop.example/"]]) {
      const r = await new Promise((resolve) => {
        const p = spawn(vpy, ["-m", "ludion", ...args], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
        const err = [];
        p.stderr.on("data", (c) => err.push(c));
        p.stdout.resume();
        p.on("close", (code) => resolve({ code, stderr: Buffer.concat(err).toString("latin1") }));
      });
      assert.equal(r.code, 0, `${encoding}: ludion ${args[0]} exited ${r.code}: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /Traceback|UnicodeEncodeError/, `${encoding}: ${r.stderr}`);
    }
  }
});

test(`DIV-1: TypeScript: clean ${MODE} → npm install (packed) → init → Card → ludionFetch → VERIFIED in ≤${LIMIT_S}s`, { timeout: (LIMIT_S + 300) * 1000 }, (t) => check("ts", t));
test(`DIV-1: Python: clean ${MODE} → pip install (wheel, hash-pinned deps) → init → Card → DiverAuth → VERIFIED in ≤${LIMIT_S}s`, { timeout: (LIMIT_S + 300) * 1000 }, (t) => check("py", t));
