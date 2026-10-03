// PRIV-5 (−): the Card Host keeps nothing of whoever fetches a card or a key directory (spec §14.4,
// ADR-041): no IP, User-Agent or time, anywhere. The production Worker (worker.mjs) runs in front of
// the real Registry Durable Object class (services/registry/worker.mjs, on an in-memory storage):
//   - what reaches the Registry is the Diver id and nothing of the visitor's (no header, no path,
//     no query, no IP, no User-Agent, no cookie);
//   - nothing is logged (console) and nothing is written by the Card Host;
//   - the Worker's config has observability, logs and logpush off, no tail consumers, no storage;
//   - the code has no console call and no write.
// The judge is tried on planted Card Hosts first: one that hands the visitor's request on, one that logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cardWorker, { registryLookup } from "../worker.mjs";
import { createCardHost, DIRECTORY_PATH, CARD_PATH } from "../src/index.mjs";
import registryWorker, { RegistryState } from "../../../services/registry/worker.mjs";
import { memoryStorage } from "../../../services/registry/src/durable.mjs";
import { diverStore } from "../../../services/registry/test/support.mjs";
import { createRegistryClient } from "@ludion/diver";
import { generateRegistryKey } from "@ludion/gate-core/staple";
import { importGraph } from "./import-graph.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANARIES = ["ua-canary-q7", "203.0.113.77", "198.51.100.33", "cookie-canary-k2", "query-canary-z9", "ref-canary-m4"];

async function world() {
  const key = await generateRegistryKey();
  const env = { REGISTRY_SIGNING_KEY: JSON.stringify(key.privateJwk), REGISTRY_ORIGIN: "https://registry.ludion.ai", REGISTRY_ISSUER: "https://registry.ludion.ai" };
  const durable = new RegistryState({ storage: memoryStorage() }, env);
  const seen = [];
  const namespace = (record) => ({ idFromName: (n) => n, get: () => ({ fetch: async (req) => { if (record) seen.push({ url: req.url, method: req.method, headers: [...req.headers] }); return durable.fetch(req); } }) });
  const regEnv = { REGISTRY: namespace(false) };
  const client = createRegistryClient({ url: "https://registry.ludion.ai", fetch: (url, init) => registryWorker.fetch(new Request(url, init), regEnv) });
  const d = await diverStore("PRIV-5 agent");
  d.store.signature_agent = `https://${d.store.diver_id}.agents.ludion.ai`;
  await client.register(d.store, d.root);
  const session = { kty: "OKP", crv: "Ed25519", x: d.session.x };
  await client.approveKeys(d.store, d.root, [session]);
  return { durable, seen, cardEnv: { REGISTRY: namespace(true) }, client, d };
}

const visitor = (url, method = "GET") => new Request(`${url}?q=query-canary-z9`, { method, headers: {
  "user-agent": "ua-canary-q7", "cf-connecting-ip": "203.0.113.77", "x-forwarded-for": "198.51.100.33", cookie: "s=cookie-canary-k2", referer: "https://ref-canary-m4.example/" } });

/** What is wrong, given what reached the Registry and what was logged during the Card Host's requests. */
export function keptProblems({ seen, logged }) {
  const out = [];
  for (const s of seen) {
    // A Diver id (the host's first label) and nothing more: no path, no query of the visitor's.
    if (!/^https:\/\/registry\.internal\/__card\/dvr-[a-z2-7]{16}$/.test(s.url)) out.push(`the Registry was asked ${s.url}`);
    if (s.method !== "GET") out.push(`the Registry was asked with ${s.method}`);
    const blob = JSON.stringify(s.headers);
    for (const c of CANARIES) if (blob.includes(c)) out.push(`the Registry got the visitor's ${c}`);
    if (s.headers.some(([k]) => /^(user-agent|cookie|referer|x-forwarded-for|cf-connecting-ip|x-real-ip|forwarded)$/i.test(k))) out.push(`the Registry got a visitor header`);
  }
  if (logged.length) out.push(`${logged.length} log line(s): ${logged[0].slice(0, 80)}`);
  return out;
}

async function capture(fn) {
  const logged = [], saved = {};
  for (const m of ["log", "info", "warn", "error", "debug", "trace"]) { saved[m] = console[m]; console[m] = (...a) => logged.push(a.map(String).join(" ")); }
  try { return { result: await fn(), logged }; } finally { Object.assign(console, saved); }
}

test("PRIV-5: the judge catches a Card Host that hands the visitor on, or logs (planted)", async () => {
  const w = await world(), id = w.d.store.diver_id, host = `https://${id}.agents.ludion.ai`;
  const leaky = { fetch: (request, env) => createCardHost({ lookup: async (h) => {
    const stub = env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
    const r = await stub.fetch(new Request(`https://registry.internal/__card/${h.split(".")[0]}`, { headers: request.headers }));
    return r.ok ? registryLookup({ idFromName: (n) => n, get: () => ({ fetch: async () => new Response(await r.text()) }) })(h) : undefined;
  } }).fetch(request) };
  w.seen.length = 0;
  const a = await capture(() => leaky.fetch(visitor(`${host}${CARD_PATH}`), w.cardEnv));
  assert.ok(keptProblems({ seen: w.seen, logged: a.logged, id }).some((p) => /the Registry got/.test(p)), "the visitor's headers handed on");
  const chatty = { fetch: (request, env) => { console.log(`card ${request.headers.get("user-agent")} ${request.headers.get("cf-connecting-ip")}`); return cardWorker.fetch(request, env); } };
  w.seen.length = 0;
  const b = await capture(() => chatty.fetch(visitor(`${host}${CARD_PATH}`), w.cardEnv));
  assert.ok(keptProblems({ seen: w.seen, logged: b.logged, id }).some((p) => /log line/.test(p)), "a log line");
});

test("PRIV-5: the Worker serves the card and the directory, asking the Registry for the id alone, and logs nothing", async () => {
  const w = await world(), id = w.d.store.diver_id, host = `https://${id}.agents.ludion.ai`;
  w.seen.length = 0;
  const { result, logged } = await capture(async () => {
    const card = await cardWorker.fetch(visitor(`${host}${CARD_PATH}`), w.cardEnv);
    const dir = await cardWorker.fetch(visitor(`${host}${DIRECTORY_PATH}`), w.cardEnv);
    const head = await cardWorker.fetch(visitor(`${host}${CARD_PATH}`, "HEAD"), w.cardEnv);
    return { card: [card.status, await card.json(), card.headers.get("set-cookie")], dir: [dir.status, await dir.json()], head: head.status,
      post: (await cardWorker.fetch(visitor(`${host}${CARD_PATH}`, "POST"), w.cardEnv)).status,
      unknown: (await cardWorker.fetch(visitor(`https://dvr-aaaaaaaaaaaaaaaa.agents.ludion.ai${CARD_PATH}`), w.cardEnv)).status,
      other: (await cardWorker.fetch(visitor(`https://example.com${CARD_PATH}`), w.cardEnv)).status };
  });
  assert.equal(result.card[0], 200);
  assert.equal(result.card[1].client_id, `${host}/card`);
  assert.equal(result.card[2], null, "no cookie set");
  assert.equal(result.dir[0], 200);
  assert.deepEqual(result.dir[1].keys.map((k) => k.x), [w.d.session.x], "the approved session key, and only it");
  assert.ok(result.dir[1].keys.every((k) => !("d" in k)), "public members only");
  assert.equal(result.head, 200);
  assert.equal(result.post, 405);
  assert.equal(result.unknown, 404);
  assert.equal(result.other, 404);
  assert.ok(w.seen.length >= 2, "the Registry was asked");
  assert.deepEqual(keptProblems({ seen: w.seen, logged, id }), []);
  console.log(`PRIV-5: ${w.seen.length} questions reached the Registry, each the Diver id alone; 0 visitor headers, 0 log lines`);
});

test("PRIV-5: a revoked Diver's card and directory are gone", async () => {
  const w = await world(), id = w.d.store.diver_id, host = `https://${id}.agents.ludion.ai`;
  await w.client.revoke(w.d.store, w.d.root, { reason: "retired" });
  for (const p of [CARD_PATH, DIRECTORY_PATH]) assert.equal((await cardWorker.fetch(visitor(`${host}${p}`), w.cardEnv)).status, 404, p);
});

test("PRIV-5: the judge of the import graph catches a Node built-in (planted)", () => {
  const dir = fs.mkdtempSync(path.join(HERE, ".graph-"));
  try {
    fs.writeFileSync(path.join(dir, "a.mjs"), `import { b } from "./b.mjs";\nexport default b;\n`);
    fs.writeFileSync(path.join(dir, "b.mjs"), `// import x from "node:fs" in a comment is not an import\nexport { createHash as b } from "node:crypto";\n`);
    const g = importGraph(path.join(dir, "a.mjs"));
    assert.equal(g.files.length, 2);
    assert.deepEqual(g.builtins.map((b) => b.split(" → ")[1]), ["node:crypto"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("PRIV-5: the Worker loads no Node built-in, so it runs without nodejs_compat", () => {
  const g = importGraph(path.join(HERE, "..", "worker.mjs"));
  assert.deepEqual(g.builtins, [], "Node built-ins in the Card Host's import graph");
  assert.ok(g.files.some((f) => f.endsWith(path.join("diver", "src", "card.mjs"))), "builds the card with @ludion/diver/card");
  assert.ok(!g.files.some((f) => f.endsWith(path.join("diver", "src", "keys.mjs"))), "does not load the Diver's key store");
  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "..", "wrangler.json"), "utf8"));
  assert.ok(!(cfg.compatibility_flags ?? []).some((f) => /^nodejs_compat/.test(f)), "no nodejs_compat");
});

test("PRIV-5: the Worker's config keeps nothing (observability, logs, logpush off; no tail, no storage) and the code neither logs nor writes", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "..", "wrangler.json"), "utf8"));
  assert.equal(cfg.observability?.enabled, false, "observability off");
  assert.equal(cfg.observability?.logs?.enabled, false, "Workers Logs off");
  assert.equal(cfg.observability?.logs?.invocation_logs, false, "invocation logs off");
  assert.equal(cfg.logpush, false, "logpush off");
  for (const k of ["tail_consumers", "kv_namespaces", "d1_databases", "r2_buckets", "analytics_engine_datasets", "queues", "send_email"]) assert.ok(!(k in cfg), `no ${k}`);
  assert.deepEqual(cfg.durable_objects.bindings.map((b) => [b.name, b.script_name]), [["REGISTRY", "ludion-registry"]], "the Registry is its only binding");
  for (const f of [path.join(HERE, "..", "worker.mjs"), path.join(HERE, "..", "src", "index.mjs")]) {
    const src = fs.readFileSync(f, "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    assert.doesNotMatch(src, /\bconsole\./, `${path.basename(f)} logs`);
    assert.doesNotMatch(src, /\.(put|write|append|set)\s*\(/, `${path.basename(f)} writes`);
  }
});
