#!/usr/bin/env node
// ludion-registry-keygen — make the Registry's v0 signing key (ADR-041), for the human to put in the
// production Worker's secret REGISTRY_SIGNING_KEY (docs/DEPLOY.md §6).
//
//   node services/registry/bin/keygen.mjs <path outside the repository>
//
// Writes a wrangler secrets file, {"REGISTRY_SIGNING_KEY": "<private JWK as JSON text>"}, to <path>
// (mode 0600), for `wrangler deploy --secrets-file <path>`, and prints only {"kid": ...}. Refuses a
// path inside this repository (secrets live outside it) and refuses to overwrite a file that exists.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRegistryKey } from "@ludion/gate-core/staple";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = process.argv[2];
const fail = (msg) => { process.stderr.write(`✖ ${msg}\n`); process.exit(2); };

if (!out) fail("usage: keygen.mjs <path outside the repository>, e.g. ~/.config/ludion/registry-secrets.json");
const target = path.resolve(out);
const inside = (p) => { const rel = path.relative(fs.realpathSync(REPO), p); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
const existing = (p) => { for (let d = p; ; d = path.dirname(d)) { if (fs.existsSync(d)) return fs.realpathSync(d); if (path.dirname(d) === d) return d; } };
if (inside(existing(target))) fail(`${target} is inside the repository; the signing key lives outside it (e.g. ~/.config/ludion/)`);
if (fs.existsSync(target)) fail(`${target} exists; this never overwrites a key`);

const { privateJwk, kid } = await generateRegistryKey();
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify({ REGISTRY_SIGNING_KEY: JSON.stringify(privateJwk) })}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ kid })}\n`);
