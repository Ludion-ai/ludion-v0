#!/usr/bin/env node
// One check per step of docs/DEPLOY.md §0 (the human stands production up, top to bottom). Each prints
// OK or NG, and for NG what to look at. GET only, no credentials, nothing of anyone's is sent; the
// probe agent id below is well formed and held by no one.
//
//   node scripts/prod-check.mjs cert                    *.agents.ludion.ai has a certificate (Certificate Transparency, crt.sh)
//   node scripts/prod-check.mjs dns                     *.agents.ludion.ai resolves and its TLS verifies (Proxied, certificate Active)
//   node scripts/prod-check.mjs registry [--kid <kid>]  registry.ludion.ai serves its key (the kid keygen printed); /__card/ stays inside
//   node scripts/prod-check.mjs card-host               an unknown agent's /card is 404 unknown_agent: the Card Host asks the Registry
//   node scripts/prod-check.mjs site                    ludion.ai serves this checkout's build, with the pages init points to
//
// Works the same in PowerShell and bash (no curl alias, no quoting). Exit code 0 only when OK.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENTS = ".agents.ludion.ai";
export const PROBE = "dvr-aaaaaaaaaaaaaaaa";
export const REGISTRY = "https://registry.ludion.ai";
export const SITE = "https://ludion.ai";
const T = 20_000;

/** Why a fetch failed, in the words of the step that fixes it. */
export function netProblem(e) {
  const code = String(e?.cause?.code ?? e?.code ?? "");
  const msg = String(e?.cause?.message ?? e?.message ?? e);
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return { kind: "dns", text: `the name does not resolve (${code})` };
  if (/CERT|TLS|SSL|EPROTO|UNABLE_TO|SELF_SIGNED|ALTNAME/.test(code + " " + msg)) return { kind: "tls", text: `TLS does not verify (${code || msg})` };
  if (/ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|TimeoutError|AbortError/.test(code + " " + (e?.name ?? ""))) return { kind: "connect", text: `no connection (${code || e?.name})` };
  return { kind: "other", text: `${code || e?.name || "error"}: ${msg}` };
}

const get = (fetchFn, url, init = {}) => fetchFn(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(T), ...init });
const ok = (lines) => ({ ok: true, lines });
const ng = (lines) => ({ ok: false, lines });

/** crt.sh's not_before/not_after carry no zone; they are UTC. */
const utc = (s) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

export const CHECKS = {
  async cert({ fetch: f = fetch, now = new Date() } = {}) {
    const want = `*${AGENTS}`;
    let rows;
    try {
      const r = await get(f, `https://crt.sh/?q=${encodeURIComponent(`%${AGENTS}`)}&output=json`);
      if (!r.ok) throw new Error(`crt.sh answered ${r.status}`);
      rows = await r.json();
      if (!Array.isArray(rows)) throw new Error("crt.sh did not answer a list");
    } catch (e) {
      return ng([`crt.sh could not be read (${e.message ?? e}). Look instead: SSL/TLS → Edge Certificates, the ${want} certificate says Active.`]);
    }
    const live = rows.filter((c) => String(c.name_value ?? "").split("\n").map((s) => s.trim().toLowerCase()).includes(want)
      && utc(String(c.not_before)) <= now && utc(String(c.not_after)) > now);
    if (!live.length) return ng([`no certificate for ${want} in the public logs yet (they can lag a few minutes).`, "Look at SSL/TLS → Edge Certificates: the advanced certificate for it is Active? (§4.2)"]);
    const c = live.sort((a, b) => utc(String(b.not_after)) - utc(String(a.not_after)))[0];
    return ok([`a certificate for ${want} is issued: ${c.issuer_name ?? "?"}, valid until ${utc(String(c.not_after)).toISOString().slice(0, 10)}.`]);
  },

  async dns({ fetch: f = fetch } = {}) {
    const url = `https://${PROBE}${AGENTS}/`;
    try {
      const r = await get(f, url);
      return ok([`${PROBE}${AGENTS} resolves and its TLS verifies (answered ${r.status}; before the Card Host is out, any status is fine).`]);
    } catch (e) {
      const p = netProblem(e);
      const fix = { dns: "Add the DNS record: Type AAAA, Name *.agents, IPv6 100::, Proxied (§4.3).",
        tls: "The certificate is not Active yet (§4.2), or the record is DNS only: make it Proxied (orange cloud, §4.3).",
        connect: "The record is DNS only (grey cloud): make it Proxied (§4.3).", other: "Look at §4.2 and §4.3." }[p.kind];
      return ng([`${url}: ${p.text}.`, fix]);
    }
  },

  async registry({ fetch: f = fetch, kid } = {}) {
    let keys;
    try {
      const r = await get(f, `${REGISTRY}/.well-known/ludion-keys`);
      if (r.status !== 200) return ng([`${REGISTRY}/.well-known/ludion-keys answered ${r.status}: is ludion-registry deployed with its custom domain (§6.3)?`]);
      keys = (await r.json())?.keys;
    } catch (e) { return ng([`${REGISTRY}: ${netProblem(e).text}. Deploy the Registry (§6.3); its custom domain makes the DNS record and certificate.`]); }
    const kids = Array.isArray(keys) ? keys.map((k) => k?.kid).filter(Boolean) : [];
    if (!kids.length) return ng(["the Registry serves no key: was it deployed with --secrets-file (REGISTRY_SIGNING_KEY, §6.3)?"]);
    if (kid && !kids.includes(kid)) return ng([`the Registry's key is ${kids.join(", ")}, not the ${kid} that keygen printed: it runs with another key (§6.1, §6.3).`]);
    let inside;
    try { inside = (await get(f, `${REGISTRY}/__card/${PROBE}`)).status; } catch (e) { return ng([`${REGISTRY}/__card/: ${netProblem(e).text}.`]); }
    if (inside !== 404) return ng([`${REGISTRY}/__card/${PROBE} answered ${inside}: the Card Host's inside question must not be open to the Internet (404).`]);
    return ok([`the Registry serves key ${kids.join(", ")}${kid ? " (the one keygen printed)" : " (compare it with the kid keygen printed)"}; /__card/ is not open (404).`]);
  },

  async "card-host"({ fetch: f = fetch } = {}) {
    const url = `https://${PROBE}${AGENTS}/card`;
    let r, body;
    try { r = await get(f, url); body = await r.text(); } catch (e) {
      return ng([`${url}: ${netProblem(e).text}. Steps §4.2 and §4.3 first (\`node scripts/prod-check.mjs dns\`).`]);
    }
    let error;
    try { error = JSON.parse(body)?.error; } catch { /* not the Card Host's JSON */ }
    if (r.status === 404 && error === "unknown_agent") return ok([`${PROBE}${AGENTS}/card is 404 unknown_agent over verified TLS: the Card Host is out and asks the Registry.`]);
    if (r.status === 503 && error === "registry_unavailable") return ng([`the Card Host is out but cannot ask the Registry (503 registry_unavailable): deploy the Registry first (§6.3), then the Card Host again (§6.4).`]);
    return ng([`${url} answered ${r.status}${error ? ` ${error}` : ""}, not the Card Host's 404 unknown_agent: is ludion-card-host deployed with its route *.agents.ludion.ai/* (§6.4)?`]);
  },

  async site({ fetch: f = fetch, hash } = {}) {
    const want = hash ?? (await import("../site/build.mjs")).siteHash();
    const lines = [], bad = [];
    try {
      const r = await get(f, `${SITE}/_build.json`);
      const site = r.ok ? (await r.json().catch(() => null))?.site : null;
      if (site !== want) bad.push(`${SITE}/_build.json says ${site ?? `nothing (${r.status})`}, this checkout's build is ${want}: deploy it (§1.5), from main after git pull`);
      else lines.push(`${SITE} serves this checkout's build (${want}).`);
    } catch (e) { return ng([`${SITE}: ${netProblem(e).text}.`]); }
    // The pages and endpoints `npx ludion-ai init` and the refusals point to.
    const expect = [["/", 200], ["/ja", 200], ["/quickstart", 200], ["/agent", 200], ["/gate", 200], ["/mandate", 200], ["/scan", 200],
      ["/e/signature_required", 200], ["/ja/e/signature_required", 200], [`/badge/${PROBE}.svg`, 200], ["/api/init-answer", 405]];
    for (const [p, status] of expect) {
      try { const s = (await get(f, `${SITE}${p}`)).status; if (s !== status) bad.push(`${p} answered ${s}, not ${status}`); }
      catch (e) { bad.push(`${p}: ${netProblem(e).text}`); }
    }
    if (bad.length) return ng([...lines, ...bad]);
    return ok([...lines, `${expect.length} pages and endpoints answer as they should (init's answer endpoint takes POST only: 405 on GET).`]);
  },
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [step] = process.argv.slice(2);
  const i = process.argv.indexOf("--kid");
  if (!CHECKS[step]) {
    console.log(`usage: node scripts/prod-check.mjs <${Object.keys(CHECKS).join("|")}> [--kid <kid>]`);
    process.exit(2);
  }
  const r = await CHECKS[step]({ kid: i > 0 ? process.argv[i + 1] : undefined });
  console.log(`${r.ok ? "OK" : "NG"}  ${step}: ${r.lines.join("\n    ")}`);
  process.exit(r.ok ? 0 : 1);
}
