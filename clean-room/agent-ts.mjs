// DIV-1, the TypeScript/JS agent side. Runs inside a clean node:22 container (CI) or, as the
// documented fallback, in a fresh temp dir with an isolated npm cache and config. It uses only
// what an agent developer would: the packed tarballs, `npm install`, `npx ludion init`, and
// `ludionFetch` — nothing from the monorepo.
//
//   node agent-ts.mjs --gate http://127.0.0.1:PORT --pkgs DIR      (cwd: an empty work dir)
//
// Prints one JSON line: { ok, steps: { install, init, publish, first_verified }, responses, store }.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const gate = arg("gate"), pkgs = arg("pkgs");
const cwd = process.cwd();
const steps = {};
const t0 = performance.now();
const lap = (name, since) => { steps[name] = Math.round(performance.now() - since) / 1000; };
const fail = (why, extra = {}) => { console.log(JSON.stringify({ ok: false, why, steps, ...extra })); process.exit(1); };

function run(cmd, args, opts = {}) {
  // npm is npm.cmd on Windows (fallback only); a shell resolves it there.
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${r.status}`, { stderr: (r.stderr ?? "").slice(-1500), stdout: (r.stdout ?? "").slice(-500) });
  return r.stdout;
}

// 1. install the packed `ludion` (the one package on npm, ADR-036) like any npm user
let t = performance.now();
const tarballs = fs.readdirSync(pkgs).filter((f) => f.endsWith(".tgz")).map((f) => path.join(pkgs, f));
if (!tarballs.length) fail(`no tarballs in ${pkgs}`);
// An agent project of its own, so npm never adopts a parent directory as the project root.
fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "div1-agent", private: true, type: "module" }, null, 2));
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...tarballs]);
lap("install", t);

// 2. init: Root sealed with the operator's passphrase, Session key, directory and Card
t = performance.now();
const cli = path.join(cwd, "node_modules", "ludion", "bin", "ludion.mjs");
run(process.execPath, [cli, "init", "--name", "DIV-1 TS Agent", "--contact", "mailto:ops@div1.example"]);
lap("init", t);

// 3. publish: hand the two files to the Card Host (a local one; its document root is ./published)
t = performance.now();
fs.mkdirSync(path.join(cwd, "published", ".well-known"), { recursive: true });
fs.copyFileSync(path.join(cwd, "card"), path.join(cwd, "published", "card"));
fs.copyFileSync(path.join(cwd, ".well-known", "http-message-signatures-directory"), path.join(cwd, "published", ".well-known", "http-message-signatures-directory"));
lap("publish", t);

// 4. sign: one line, ludionFetch, against a site running the Gate
t = performance.now();
// Imported by package name from the agent's own node_modules, as agent code would.
fs.writeFileSync(path.join(cwd, "diver.mjs"), 'export { createDiverSigner, ludionFetch } from "ludion/diver";\n');
const { createDiverSigner, ludionFetch } = await import(pathToFileURL(path.join(cwd, "diver.mjs")).href);
const store = JSON.parse(fs.readFileSync(path.join(cwd, "ludion.json"), "utf8"));
const signer = await createDiverSigner({ sessionPrivateJwk: store.session, signatureAgent: store.signature_agent, cimd: true });
const responses = [];
for (const [method, p, body] of [["GET", "/products?q=camera"], ["POST", "/checkout/1", '{"sku":"cam-1","qty":1}']]) {
  const r = await ludionFetch(`${gate}${p}`, { method, body, headers: body ? { "content-type": "application/json" } : {} }, { signer });
  responses.push({ method, status: r.status, body: await r.json() });
}
lap("first_verified", t);
steps.total = Math.round(performance.now() - t0) / 1000;
console.log(JSON.stringify({ ok: true, steps, responses, store: { diver_id: store.diver_id, signature_agent: store.signature_agent } }));
