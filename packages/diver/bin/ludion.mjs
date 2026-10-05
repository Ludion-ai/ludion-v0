#!/usr/bin/env node
// ludion — the CLI. Three minutes to register, one line to sign, one command to see the fear.
//
//   npx ludion init [--name "My Agent" --contact mailto:ops@example.com --domain dvr-xxx.agents.ludion.ai] [--dev]
//   npx ludion sign <METHOD> <URL> [--body '{"a":1}']     # prints Web Bot Auth headers for curl/httpx/anything
//   npx ludion rotate [--overlap 300] [--force]            # session key: publish the next one, then (after the overlap) switch
//   npx ludion register [--registry https://registry.ludion.ai]  # register with the Registry (Root), approve the session key, fetch a Staple
//   npx ludion staple                                      # fetch a fresh Staple (signed by the session key)
//   npx ludion revoke [--compromised] [--key <kid>]        # revoke this Diver (or one session key) at the Registry (Root)
//   npx ludion mandate create --site <origin> --scope read,checkout [--checkout-max N --currency JPY --per-day N] [--expires 24h]
//   npx ludion mandate list | revoke <jti>                 # the operator's own limits on this agent (Root)
//   npx ludion doctor                                      # self-check: keys, clock, directory, card
//   npx ludion scan <access.log|dir|-> [--json]            # log-first Gate: what touched what, unsigned
//   npx ludion report --events <events.ndjson> [--date D] [--tz Asia/Tokyo] [--lang ja] [--format html]  # the daily report
//
// Keys live in ./ludion.json (v0). The Root private key is sealed there with the operator's
// passphrase (LUDION_ROOT_PASSPHRASE, or a prompt on a terminal): scrypt + AES-256-GCM, see
// docs/adr/ADR-019. Only `--dev` (or LUDION_DEV=1) stores it in plaintext, and every command
// then says so on stderr. KMS / OS keychain backends are next (spec §12.4).

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { initScreen, screenLang, shouldAsk, askWhy, ANSWER_URL } from "../src/init-screen.mjs";
import { generateEd25519, diverIdFromRoot, directoryDocument, cardDocument, clientDocument, createDiverSigner, sealRootKey, openRootKey, isSealedRoot, MIN_PASSPHRASE_LENGTH,
  rotateSession, RotationPendingError, DEFAULT_OVERLAP_S, createRegistryClient, mandateTerms, describeMandate } from "../src/index.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(`--${name}`);
const STORE = path.resolve(process.cwd(), "ludion.json");
const out = (s) => process.stdout.write(s + "\n");
const err = (s) => process.stderr.write(s + "\n");
const DEV = has("dev") || process.env.LUDION_DEV === "1";

function devBanner() {
  err("⚠ ────────────────────────────────────────────────────────────────────────");
  err("⚠  LUDION DEV MODE: the Root private key is stored in PLAINTEXT in ludion.json.");
  err("⚠  Whoever reads that file owns this identity. Development only: never register");
  err("⚠  or use a dev identity in production. `ludion init --force` without --dev seals it.");
  err("⚠ ────────────────────────────────────────────────────────────────────────");
}

/** Read a line from the terminal without echoing it. Terminal only; nothing is written anywhere. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl._writeToOutput = (chunk) => { if (chunk.includes(question)) rl.output.write(chunk); };
    rl.question(question, (answer) => { rl.close(); process.stderr.write("\n"); resolve(answer); });
  });
}

async function rootPassphrase({ confirm }) {
  if (process.env.LUDION_ROOT_PASSPHRASE) return process.env.LUDION_ROOT_PASSPHRASE;
  if (!process.stdin.isTTY) return undefined;
  const a = await promptHidden(`Root passphrase (at least ${MIN_PASSPHRASE_LENGTH} characters): `);
  if (confirm && a !== await promptHidden("Repeat the passphrase: ")) throw new Error("the passphrases do not match. Nothing was written.");
  return a;
}

/** Write a private file atomically (temp file in the same directory, then rename), owner-only. */
function writePrivate(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function init() {
  if (fs.existsSync(STORE) && !has("force")) return out(`ludion.json already exists. Use --force to overwrite (this creates a NEW identity).`);
  let passphrase;
  if (!DEV) {
    passphrase = await rootPassphrase({ confirm: true });
    if (!passphrase) throw new Error(`the Root key must be protected. Set LUDION_ROOT_PASSPHRASE (at least ${MIN_PASSPHRASE_LENGTH} characters), run \`ludion init\` in a terminal to be prompted, or pass --dev for a throwaway development identity (plaintext Root). Nothing was written.`);
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`the Root passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters. Nothing was written.`);
  }
  const root = await generateEd25519();
  const session = await generateEd25519();
  const diverId = diverIdFromRoot(root.publicJwk);
  const domain = flag("domain", `${diverId}.agents.ludion.ai`);
  const origin = `https://${domain}`;
  const store = {
    v: 0, ...(DEV ? { dev: true } : {}), diver_id: diverId, signature_agent: origin,
    name: flag("name", "Unnamed agent"), contacts: [flag("contact", "mailto:change-me@example.com")],
    root: DEV ? root.privateJwk : await sealRootKey(root.privateJwk, passphrase),
    session: session.privateJwk, created: new Date().toISOString(),
  };
  writePrivate(STORE, JSON.stringify(store, null, 2));
  const dir = directoryDocument([session.publicJwk]);
  const card = cardDocument({ origin, name: store.name, contacts: store.contacts, ludion: { diver_id: diverId, registry: "https://registry.ludion.ai", root_kid: root.kid } });
  fs.mkdirSync(".well-known", { recursive: true });
  fs.writeFileSync(path.join(".well-known", "http-message-signatures-directory"), JSON.stringify(dir, null, 2));
  fs.writeFileSync("card", JSON.stringify(card, null, 2));
  // The MCP client_id: the same name and keys, in the shape every authorization server reads.
  fs.writeFileSync("client", JSON.stringify(clientDocument({ origin, name: store.name, contacts: store.contacts }), null, 2));
  // One screen (spec §9.2, DIV-5): the name, the same name on the web and on MCP, how to erase it, a badge.
  const lang = screenLang();
  for (const line of initScreen({ diverId, origin, lang })) out(line);
  if (DEV) devBanner();
  out("");
  out(`  Wrote ludion.json (KEEP PRIVATE — ${DEV ? "DEV MODE: Root key in plaintext" : "Root key sealed with your passphrase; the passphrase is not stored"})`);
  out(`  Wrote .well-known/http-message-signatures-directory, card and client: publish them at ${origin} (or run \`npx ludion register\` once the Registry is live)`);
  out(`  Next: npx ludion sign GET https://example.com/`);
  // One optional question (DIV-6): only at a terminal, never in CI; skipping sends nothing.
  if (shouldAsk({ force: has("ask"), refuse: has("no-question"), stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY })) {
    await askWhy({ lang, input: process.stdin, output: process.stdout, url: process.env.LUDION_INIT_ANSWER_URL || ANSWER_URL });
  }
}

async function loadSigner() {
  if (!fs.existsSync(STORE)) throw new Error("no ludion.json — run `npx ludion init` first");
  const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
  if (store.dev) devBanner();
  else if (!isSealedRoot(store.root)) err("⚠ ludion.json holds the Root private key in plaintext (made by an older ludion, or edited by hand). Treat this identity as development-only and create a sealed one with `ludion init --force`.");
  const signer = await createDiverSigner({ sessionPrivateJwk: store.session, signatureAgent: store.signature_agent, insecureAllowHttp: has("insecure"),
    staple: () => currentStaple(store) });
  return { store, signer };
}

/** The stored Staple, while it is valid and bound to the current session key. */
function currentStaple(store) {
  const s = store.staple;
  if (!s?.staple || !(s.exp * 1000 > Date.now()) || s.kid !== store.session.kid) return undefined;
  return s.staple;
}

function registryClient(store) {
  const url = flag("registry") ?? store.registry?.url ?? process.env.LUDION_REGISTRY ?? "https://registry.ludion.ai";
  return createRegistryClient({ url });
}

/** Open the Root for a Registry statement. It stays in memory for this command only. */
async function openRoot(store) {
  if (store.root?.d) return store.root; // dev identity (warned about in loadSigner)
  const passphrase = await rootPassphrase({ confirm: false });
  if (!passphrase) throw new Error("this needs the Root: set LUDION_ROOT_PASSPHRASE or run in a terminal to be prompted.");
  return openRootKey(store.root, passphrase);
}

function save(store) { writePrivate(STORE, JSON.stringify(store, null, 2)); }

async function fetchStaple(client, store) {
  const s = await client.staple(store, store.session);
  store.staple = { staple: s.staple, iat: s.iat, exp: s.exp, kid: store.session.kid, ...(s.revoked ? { revoked: true } : {}) };
  return s;
}

async function register() {
  const { store } = await loadSigner();
  const client = registryClient(store);
  const root = await openRoot(store);
  const r = await client.register(store, root);
  const keys = [store.session, ...(store.next ? [store.next] : [])];
  await client.approveKeys(store, root, keys);
  store.registry = { url: client.origin, registered: new Date().toISOString() };
  const s = await fetchStaple(client, store);
  save(store);
  out(`✔ Registered ${r.diver_id} at ${client.origin}; approved ${keys.map((k) => k.kid).join(", ")}`);
  out(`  Staple until ${new Date(s.exp * 1000).toISOString()}${s.revoked ? " — REVOKED" : ""}. Refresh with \`ludion staple\` (the SDK refreshes at half-life).`);
}

async function stapleCmd() {
  const { store } = await loadSigner();
  if (!store.registry) throw new Error("not registered: run `ludion register` first");
  const s = await fetchStaple(registryClient(store), store);
  save(store);
  out(`✔ Staple until ${new Date(s.exp * 1000).toISOString()}${s.revoked ? " — this Diver is REVOKED" : ""}`);
}

async function revoke() {
  const { store } = await loadSigner();
  if (!store.registry) throw new Error("not registered: nothing to revoke at a Registry");
  const client = registryClient(store);
  const root = await openRoot(store);
  const kid = flag("key");
  const r = await client.revoke(store, root, { ...(kid ? { jkt: [kid] } : {}), reason: has("compromised") ? "compromised" : "retired" });
  store.revoked = { seq: r.seq, scope: r.scope, at: new Date().toISOString(), ...(kid ? { kid } : {}) };
  save(store);
  out(`✔ Revoked ${kid ? `session key ${kid}` : `Diver ${store.diver_id}`} (entry ${r.seq}). Subscribed Gates apply it within seconds; every other Gate when the last Staple expires (≤1 h).`);
}

async function signCmd() {
  const [, method, url] = args;
  if (!method || !url) return out("usage: ludion sign <METHOD> <URL> [--body '...'] [--curl]");
  const { signer } = await loadSigner();
  const body = flag("body");
  const headers = await signer.headersFor({ method, url, headers: body ? { "content-type": "application/json" } : {}, body });
  if (has("curl")) {
    out(`curl -X ${method.toUpperCase()} ${Object.entries(headers).map(([k, v]) => `-H '${k}: ${v.replace(/'/g, "'\\''")}'`).join(" \\\n  ")}${body ? ` \\\n  -d '${body}'` : ""} \\\n  '${url}'`);
  } else {
    for (const [k, v] of Object.entries(headers)) out(`${k}: ${v}`);
  }
  out(`\n# expires in 60s. Generate per request; never reuse (draft §6.9).`);
}

async function rotate() {
  const { store } = await loadSigner();
  const overlapS = Number(flag("overlap", DEFAULT_OVERLAP_S));
  let r;
  try { r = await rotateSession(store, { overlapS, force: has("force") }); }
  catch (e) {
    if (!(e instanceof RotationPendingError)) throw e;
    const wait = Math.ceil((e.activeAt - Date.now()) / 1000);
    throw new Error(`${e.message} (in ${wait}s), when every verifier's cached directory has had time to pick it up. Run \`ludion rotate\` again then. --force switches now, and Gates that still cache the old directory will not find the new key until their cache expires.`);
  }
  // Registered: the Registry must approve the next key before it is published (Root), and the new
  // key needs its own Staple once it signs.
  const client = store.registry ? registryClient(store) : undefined;
  if (client && r.step === "published") await client.approveKeys(r.store, await openRoot(store), [r.store.session, r.store.next]);
  const dirFile = path.join(".well-known", "http-message-signatures-directory");
  fs.mkdirSync(".well-known", { recursive: true });
  // Publishing: directory first (a crash leaves an unused key published). Activating: store first
  // (a crash leaves the old key published a little longer, never a signing key that is unpublished).
  if (r.step === "published") { fs.writeFileSync(dirFile, JSON.stringify(r.directory, null, 2)); writePrivate(STORE, JSON.stringify(r.store, null, 2)); }
  else { writePrivate(STORE, JSON.stringify(r.store, null, 2)); fs.writeFileSync(dirFile, JSON.stringify(r.directory, null, 2)); }
  if (r.step === "published") {
    out(`✔ Next session key published: ${r.store.next.kid} (still signing with ${store.session.kid})`);
    out(`  It becomes active at ${r.store.next.active_at}. Run \`ludion rotate\` again then.`);
  } else {
    out(`✔ Now signing with ${r.store.session.kid}; ${store.session.kid} left the directory and the store.`);
    out(`  Verifiers stop accepting the old key when their cached directory expires.`);
    if (client) {
      try { const s = await fetchStaple(client, r.store); save(r.store); out(`  Staple for the new key until ${new Date(s.exp * 1000).toISOString()}.`); }
      catch (e) { err(`⚠ could not fetch a Staple for the new key (${e.message}); run \`ludion staple\`.`); }
    }
  }
  out(`  Wrote ${dirFile.split(path.sep).join("/")}  ← publish it again at ${store.signature_agent}/.well-known/http-message-signatures-directory`);
}

async function doctor() {
  const problems = [], warnings = [];
  let store;
  try { ({ store } = await loadSigner()); out(`✔ keys load (session kid ${store.session.kid})`); } catch (e) { return out(`✖ ${e.message}`); }
  if (isSealedRoot(store.root)) out(`✔ Root sealed (${store.root.sealed.kdf} + ${store.root.sealed.cipher}), kid ${store.root.kid}`);
  else problems.push(`${store.dev ? "DEV MODE: " : ""}the Root private key is in plaintext on disk`);
  if (!/^dvr-[a-z2-7]{16}$/.test(store.diver_id)) problems.push("diver_id malformed");
  const skew = Math.abs(Date.now() - Date.now()); // placeholder: compare against a time source in v0.1
  out(`✔ clock: local time ${new Date().toISOString()} (no external time check yet; signatures allow ±30s)`);
  const origin = store.signature_agent;
  for (const p of ["/.well-known/http-message-signatures-directory", "/card", "/client"]) {
    try {
      const r = await fetch(origin + p, { redirect: "manual" });
      const okType = p === "/card" || p === "/client" || (r.headers.get("content-type") ?? "").includes("http-message-signatures-directory+json");
      if (r.status !== 200) problems.push(`${p} returned ${r.status} (must be 200, no redirect)`);
      else if (!okType) problems.push(`${p} served with ${r.headers.get("content-type")} — must be application/http-message-signatures-directory+json`);
      else {
        const j = await r.json();
        if (p.startsWith("/.well-known") && !j.keys?.some((k) => k.kid === store.session.kid)) problems.push("directory does not contain the current session key");
        if ((p === "/card" || p === "/client") && j.client_id !== `${origin}${p}`) problems.push(`${p.slice(1)} client_id must equal its URL`);
        // The client_id is public: only private_key_jwt (the agent's key at the token endpoint) keeps it the agent's own (MCP-3).
        if ((p === "/card" || p === "/client") && j.token_endpoint_auth_method !== "private_key_jwt") {
          warnings.push(`${p} says token_endpoint_auth_method ${JSON.stringify(j.token_endpoint_auth_method ?? null)}, not "private_key_jwt": ${j.token_endpoint_auth_method === "none" ? "a public client — " : ""}an authorization server may then give a token to anyone who uses your client_id. Publish the ${p.slice(1)} file init wrote.`);
        }
        if (!problems.length) out(`✔ ${origin}${p}`);
      }
    } catch (e) { problems.push(`${p} unreachable: ${e.message}`); }
  }
  if (problems.length) { out(`\n${problems.length} problem(s):`); problems.forEach((p) => out(`  ✖ ${p}`)); process.exitCode = 1; }
  if (warnings.length) { out(`\n${warnings.length} warning(s):`); warnings.forEach((w) => out(`  ⚠ ${w}`)); process.exitCode = 1; }
  if (!problems.length && !warnings.length) out(`\nAll good. Sites running Ludion Gate will see you as VERIFIED (depth 0 until you register).`);
}

// ---- mandate: the operator's own limits on this agent (lane 2 spec §3.2) -----
// Issued and withdrawn by the Registry on a statement the Root signs; kept in ludion.json, where
// mandateFor(me) finds the one for each site. The running agent needs no Root for any of it.
async function mandate() {
  const sub = args[1];
  const { store } = await loadSigner();
  const now = Math.floor(Date.now() / 1000);
  if (sub === "list") {
    const all = store.mandates ?? [];
    if (!all.length) return out("No Mandates. Create one: npx ludion-ai mandate create --site https://shop.example --scope read");
    for (const m of all) {
      const state = m.revoked ? "revoked" : m.exp <= now ? "expired" : `until ${new Date(m.exp * 1000).toISOString()}`;
      out(`${m.jti}  ${describeMandate(m)}  (${state})`);
    }
    return;
  }
  if (sub !== "create" && sub !== "revoke") return out("usage: ludion mandate <create --site <https origin> --scope read,checkout [--checkout-max N --currency JPY] [--per-day N] [--expires 24h] | list | revoke <jti>>");
  if (!store.registry) throw new Error("not registered: run `ludion register` first (the Registry issues and withdraws Mandates)");
  const client = registryClient(store);
  if (sub === "create") {
    const terms = mandateTerms({ site: flag("site"), scope: flag("scope"), perDay: flag("per-day"), checkoutMax: flag("checkout-max"), currency: flag("currency"), expires: flag("expires") });
    const r = await client.createMandate(store, await openRoot(store), terms);
    const m = { jti: r.jti, aud: terms.aud, scope: terms.scope, ...(terms.limits ? { limits: terms.limits } : {}), iat: now, exp: r.exp, mandate: r.mandate };
    store.mandates = [...(store.mandates ?? []).filter((x) => x.exp > now - 86_400), m];
    save(store);
    out(`✔ Mandate ${r.jti}: ${describeMandate(m)}, until ${new Date(r.exp * 1000).toISOString()}`);
    out(`  Attach it: createDiverSigner({ sessionPrivateJwk: me.session, signatureAgent: me.signature_agent, staple: () => me.staple?.staple, mandate: mandateFor(me) })`);
    return;
  }
  const jti = args[2];
  if (!/^mdt-[A-Za-z0-9_-]{8,64}$/.test(jti ?? "")) throw new Error("usage: ludion mandate revoke <jti> (see `ludion mandate list`)");
  const r = await client.revokeMandate(store, await openRoot(store), jti);
  store.mandates = (store.mandates ?? []).map((m) => (m.jti === jti ? { ...m, revoked: { seq: r.seq, at: new Date().toISOString() } } : m));
  save(store);
  out(`✔ Withdrew ${jti} (entry ${r.seq}). Subscribed Gates refuse it within seconds; every other Gate when the last Staple expires (≤1 h).`);
}

// ---- scan: the log-first Gate (@ludion/scan) ---------------------------------
async function scan() {
  const { main } = await import("@ludion/scan/cli");
  process.exitCode = await main(args.slice(1));
}

// ---- report: the daily report from the Gate's metadata events (@ludion/report) ----
async function report() {
  const { main } = await import("@ludion/report/cli");
  process.exitCode = await main(args.slice(1));
}

const commands = { init, sign: signCmd, rotate, register, staple: stapleCmd, revoke, mandate, doctor, scan, report };
if (!commands[cmd]) { out("usage: ludion <init|sign|rotate|register|staple|revoke|mandate|doctor|scan|report> …"); process.exit(1); }
commands[cmd]().catch((e) => { console.error("✖", e.message); process.exit(1); });
