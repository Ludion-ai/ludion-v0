// What GATE-3 measures, as functions: the install's size (a real diff of reference/<app>/install over
// reference/<app>/site) and what the first classified record must be. GATE-3 runs them on the real
// reference apps; GATE-13 runs them on planted installs and records, to show they catch what they must.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { REF } from "./harness.mjs";

export const LIMIT_S = 60, MAX_CODE_LINES = 3, MAX_CONFIG_FILES = 1;
export const CONFIG_FILES = new Set(["ludion.config.json", "wrangler.toml", "wrangler.json", "wrangler.jsonc"]);
export const README = { express: "gate-node", next: "gate-next", workers: "gate-workers" };

export function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

/** Lines changed by the install, per file, from a real diff: each hunk counts max(removed, added). */
export function installDiff(app, { ref = REF } = {}) {
  const site = path.join(ref, app, "site"), install = path.join(ref, app, "install");
  const files = walk(install).map((f) => {
    const before = path.join(site, f), after = path.join(install, f);
    let out;
    try { out = execFileSync("git", ["diff", "--no-index", "--no-color", "-U0", fs.existsSync(before) ? before : "/dev/null", after], { encoding: "utf8" }); }
    catch (e) { if (e.status !== 1) throw e; out = e.stdout; } // exit 1 = the files differ
    let changed = 0;
    const added = [];
    for (const m of out.matchAll(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/gm)) changed += Math.max(Number(m[1] ?? 1), Number(m[2] ?? 1));
    for (const l of out.split("\n")) if (l.startsWith("+") && !l.startsWith("+++")) added.push(l.slice(1));
    return { file: f, config: CONFIG_FILES.has(path.basename(f)), changed, added, created: !fs.existsSync(before) };
  });
  return { files, codeLines: files.filter((f) => !f.config).reduce((s, f) => s + f.changed, 0), configFiles: files.filter((f) => f.config).length };
}

/** What is wrong with an install (`d` from installDiff), given the adapter README the founder is shown. */
export function installProblems(app, d, readme) {
  const out = [];
  if (!d.files.length || d.files.every((f) => f.changed === 0)) out.push(`${app}: an install that changes nothing proves nothing`);
  if (d.codeLines > MAX_CODE_LINES) out.push(`${app}: ${d.codeLines} application lines changed (${d.files.map((f) => `${f.file}:${f.changed}`).join(", ")})`);
  if (d.configFiles > MAX_CONFIG_FILES) out.push(`${app}: ${d.configFiles} config files`);
  if (d.files.some((f) => /(^|\/)package(-lock)?\.json$/.test(f.file))) out.push(`${app}: dependencies come from npm install, not a hand edit`);
  for (const f of d.files.filter((x) => !x.config)) for (const line of f.added.filter((l) => l.trim())) {
    if (!readme.includes(line.trim())) out.push(`${app}: the README of @ludion/${README[app]} does not show the installed line ${JSON.stringify(line.trim())}`);
  }
  return out;
}

/**
 * What is wrong with the first classified record (the receipt the site returned to a curl request for
 * /products/2 made from t0 on: `first` is { at, event } or null) and with what the report endpoint got
 * meanwhile (`sinkEvents`: only hourly counts may arrive, never a visit — ADR-038).
 */
export function recordProblems(app, first, { t0, site, sinkEvents = [], limitS = LIMIT_S }) {
  const out = [];
  for (const e of sinkEvents) if (e.event?.kind !== "ludion.hourly") out.push(`${app}: the report endpoint got a visit: ${JSON.stringify(e.event ?? e.bad).slice(0, 200)}`);
  if (!first) return [...out, `${app}: no classified record within ${limitS}s`];
  const seconds = (first.at - t0) / 1000;
  if (first.event.site !== site) out.push(`${app}: record for site ${JSON.stringify(first.event.site)}, not ${site}`);
  if (first.event.class !== "SUSPECTED") out.push(`${app}: classified ${first.event.class}, not SUSPECTED (curl)`);
  if (first.event.route !== "/products/:id") out.push(`${app}: route ${JSON.stringify(first.event.route)}, not the template /products/:id`);
  if (!(seconds <= limitS)) out.push(`${app}: first classified record after ${seconds.toFixed(1)}s`);
  return out;
}
