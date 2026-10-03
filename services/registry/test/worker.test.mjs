// The Registry's Worker (ADR-041): every request goes to the one Durable Object, except the Card
// Host's internal question (/__card/<id>), which the Internet cannot ask. That question returns a
// Diver's public members only.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { RegistryState, CARD_PREFIX } from "../worker.mjs";
import { memoryStorage } from "../src/durable.mjs";
import { diverStore } from "./support.mjs";
import { createRegistryClient } from "@ludion/diver";
import { generateRegistryKey } from "@ludion/gate-core/staple";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importGraph } from "../../../packages/card-host/test/import-graph.mjs";

async function world() {
  const key = await generateRegistryKey();
  const durable = new RegistryState({ storage: memoryStorage() }, { REGISTRY_SIGNING_KEY: JSON.stringify(key.privateJwk), REGISTRY_ORIGIN: "https://registry.ludion.ai" });
  let asked = 0;
  const env = { REGISTRY: { idFromName: (n) => n, get: () => ({ fetch: (req) => { asked++; return durable.fetch(req); } }) } };
  return { durable, env, asked: () => asked };
}

test("registry worker: starts from the secrets file keygen writes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-keygen-"));
  try {
    const file = path.join(dir, "registry-secrets.json");
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/keygen.mjs", import.meta.url)), file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../wrangler.json", import.meta.url)), "utf8"));
    const durable = new RegistryState({ storage: memoryStorage() }, { ...cfg.vars, ...JSON.parse(fs.readFileSync(file, "utf8")) });
    const env = { REGISTRY: { idFromName: (n) => n, get: () => durable } };
    const keys = await (await worker.fetch(new Request("https://registry.ludion.ai/.well-known/ludion-keys"), env)).json();
    assert.deepEqual(keys.keys.map((k) => k.kid), [JSON.parse(r.stdout).kid], "the Worker signs with the key keygen made");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("registry worker: loads only node:crypto of Node's built-ins (nodejs_compat has it); no file store", () => {
  const g = importGraph(fileURLToPath(new URL("../worker.mjs", import.meta.url)));
  assert.deepEqual([...new Set(g.builtins.map((b) => b.split(" → ")[1]))], ["node:crypto"]);
  assert.ok(!g.files.includes(fs.realpathSync(fileURLToPath(new URL("../src/node.mjs", import.meta.url)))), "the file store stays off the Worker");
  const cfg = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../wrangler.json", import.meta.url)), "utf8"));
  assert.ok(cfg.compatibility_flags.includes("nodejs_compat"));
});

test("registry worker: the Internet cannot ask the Card Host's question; everything else reaches the Durable Object", async () => {
  const w = await world();
  const blocked = await worker.fetch(new Request(`https://registry.ludion.ai${CARD_PREFIX}dvr-aaaaaaaaaaaaaaaa`), w.env);
  assert.equal(blocked.status, 404);
  assert.equal(w.asked(), 0, "never forwarded");
  const keys = await worker.fetch(new Request("https://registry.ludion.ai/.well-known/ludion-keys"), w.env);
  assert.equal(keys.status, 200);
  assert.ok((await keys.json()).keys.length >= 1);
  assert.equal(w.asked(), 1);
});

test("registry worker: a Diver's public record has its public members only; unknown or malformed is 404", async () => {
  const w = await world();
  const client = createRegistryClient({ url: "https://registry.ludion.ai", fetch: (url, init) => worker.fetch(new Request(url, init), w.env) });
  const d = await diverStore("Worker agent");
  await client.register(d.store, d.root);
  await client.approveKeys(d.store, d.root, [{ kty: "OKP", crv: "Ed25519", x: d.session.x }]);
  const r = await w.durable.fetch(new Request(`https://registry.internal${CARD_PREFIX}${d.store.diver_id}`));
  assert.equal(r.status, 200);
  const rec = await r.json();
  assert.deepEqual(Object.keys(rec).sort(), ["contacts", "diver_id", "keys", "name", "root_kid"]);
  assert.deepEqual(rec.keys.map((k) => Object.keys(k).sort()), [["crv", "kid", "kty", "x"]]);
  assert.ok(!JSON.stringify(rec).includes(d.root.d) && !JSON.stringify(rec).includes(d.session.d), "no private member");
  for (const id of ["dvr-aaaaaaaaaaaaaaaa", "dvr-short", "../divers", ""]) {
    assert.equal((await w.durable.fetch(new Request(`https://registry.internal${CARD_PREFIX}${id}`))).status, 404, id);
  }
});
