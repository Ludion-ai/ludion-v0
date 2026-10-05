// WEB-12's measure: the page that shows how to install the Gate (/gate and /ja/gate) shows the code
// GATE-1 and GATE-3 run. For each runtime on the page — Express, Next.js, Cloudflare Workers — the
// reference install (reference/<app>/install over reference/<app>/site, measured with a real diff by
// reference/gate3-measure.mjs) is the reader's site after following the section:
//   - the dependency is `npm install ludion-ai`, the one package (ADR-036);
//   - every application line the install adds is on the page, and every line the page shows is in the
//     installed app (a comment stands for the reader's own code: "// your Worker, unchanged");
//   - the config is the same (its keys and values, the site's own `site_id` aside); the Next.js
//     section says it is the same as for Express, so Express's block is Next.js's.
// GATE-3 then shows those installs classify within 60 s, and GATE-1 that a person gets the same bytes.
import fs from "node:fs";
import path from "node:path";
import { installDiff, CONFIG_FILES } from "../../reference/gate3-measure.mjs";
import { REF } from "../../reference/harness.mjs";

export const RUNTIMES = Object.freeze([
  { app: "express", heading: /Express/, config: "ludion.config.json" },
  { app: "next", heading: /Next\.js/, config: "ludion.config.json", configFrom: "express" },
  { app: "workers", heading: /Workers/, config: "wrangler.toml" },
]);

/** The page's `##` sections in order, each with its fenced blocks. */
export function sections(mdx) {
  const out = [];
  let cur = null;
  for (const m of mdx.replace(/\r\n/g, "\n").matchAll(/^## (.+)$|^```(\w+)(?: title="([^"]+)")?\n([\s\S]*?)^```[ \t]*$/gm)) {
    if (m[1]) { out.push((cur = { heading: m[1].trim(), blocks: [] })); continue; }
    cur?.blocks.push({ lang: m[2], title: m[3] ?? null, code: m[4] });
  }
  return out;
}

/** The installs GATE-1 and GATE-3 run: per app, the real diff and the installed files' text. */
export function installs({ ref = REF } = {}) {
  return Object.fromEntries(RUNTIMES.map(({ app }) => {
    const diff = installDiff(app, { ref });
    const files = Object.fromEntries(diff.files.map((f) => [f.file, fs.readFileSync(path.join(ref, app, "install", f.file), "utf8")]));
    return [app, { diff, files }];
  }));
}

const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const isComment = (l) => /^(\/\/|#)/.test(l);
// The site's own id is the reader's to choose; everything else must match.
const SITE_ID = /^(site_id\s*=\s*)"[^"]*"$/;
const tomlLine = (l) => l.replace(SITE_ID, '$1"<site>"');
const withoutSiteId = (o) => (o && typeof o === "object" && !Array.isArray(o) ? { ...o, site_id: typeof o.site_id === "string" && /^site-/.test(o.site_id) ? "<site>" : o.site_id } : o);

/**
 * What is wrong with the page (`mdx`, in `lang`) as a way to install the Gate, against the tested installs.
 * @returns {string[]}
 */
export function gatePageProblems(mdx, inst, lang) {
  const out = [];
  const secs = sections(mdx);
  const of = {};
  for (const r of RUNTIMES) {
    const found = secs.filter((s) => r.heading.test(s.heading));
    if (found.length !== 1) out.push(`${lang}: ${found.length} sections for ${r.app} (headings: ${secs.map((s) => s.heading).join(" | ")})`);
    else of[r.app] = found[0];
  }
  for (const r of RUNTIMES) {
    const s = of[r.app];
    if (!s) continue;
    const at = `${lang} ${r.app}`;
    const { diff, files } = inst[r.app];
    // The dependency.
    const shells = s.blocks.filter((b) => b.lang === "sh").map((b) => b.code.trim());
    if (shells.length !== 1 || shells[0] !== "npm install ludion-ai") out.push(`${at}: the install command is not \`npm install ludion-ai\` (${JSON.stringify(shells)})`);
    // The application lines, both ways.
    const shown = s.blocks.filter((b) => b.lang === "js").flatMap((b) => lines(b.code));
    if (!shown.length) out.push(`${at}: no code`);
    const added = diff.files.filter((f) => !f.config).flatMap((f) => lines(f.added.join("\n")));
    for (const l of added) if (!shown.includes(l)) out.push(`${at}: the page does not show the installed line ${JSON.stringify(l)}`);
    const app = new Set(Object.entries(files).filter(([f]) => !CONFIG_FILES.has(path.basename(f))).flatMap(([, t]) => lines(t)));
    for (const l of shown) if (!isComment(l) && !app.has(l)) out.push(`${at}: the page shows a line the tested install does not have: ${JSON.stringify(l)}`);
    // The config.
    const lang_ = r.config.endsWith(".toml") ? "toml" : "json";
    const cfgBlocks = (r.configFrom ? of[r.configFrom] : s)?.blocks.filter((b) => b.lang === lang_) ?? [];
    const installed = Object.entries(files).find(([f]) => path.basename(f) === r.config)?.[1];
    if (cfgBlocks.length !== 1) { out.push(`${at}: ${cfgBlocks.length} ${r.config} blocks`); continue; }
    if (installed == null) { out.push(`${at}: the tested install has no ${r.config}`); continue; }
    if (lang_ === "json") {
      let page;
      try { page = JSON.parse(cfgBlocks[0].code); } catch (e) { out.push(`${at}: the ${r.config} block is not JSON (${e.message})`); continue; }
      const a = JSON.stringify(withoutSiteId(page)), b = JSON.stringify(withoutSiteId(JSON.parse(installed)));
      if (a !== b) out.push(`${at}: ${r.config} on the page ${a} is not the tested one ${b}`);
    } else {
      const page = lines(cfgBlocks[0].code).map(tomlLine), all = new Set(lines(installed).map(tomlLine));
      const addedCfg = lines(diff.files.filter((f) => path.basename(f.file) === r.config).flatMap((f) => f.added).join("\n")).map(tomlLine);
      for (const l of addedCfg) if (!page.includes(l)) out.push(`${at}: the page's ${r.config} does not show the installed line ${JSON.stringify(l)}`);
      for (const l of page) if (!isComment(l) && !all.has(l)) out.push(`${at}: the page's ${r.config} shows a line the tested install does not have: ${JSON.stringify(l)}`);
    }
  }
  return out;
}
