// WEB-12 (±): the page that shows how to install the Gate (/gate, /ja/gate) is the code GATE-1 and
// GATE-3 run — Express, Next.js and Cloudflare Workers, in English and Japanese (site/test/gate-page.mjs).
// The other side: planted pages (a missing line, an old package name — @ludion/*, or `ludion`, which npm
// refused (ADR 2026-10-05-npm-name-ludion-ai) — an extra line, a config typo,
// another install command, a missing flag, a missing section, a page in one language only) and a
// planted install (a line the page does not show) are each caught; a page whose only difference is
// the site's own id is not.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gatePageProblems, installs, RUNTIMES } from "./gate-page.mjs";
import { ROOT } from "../../accept/publish/set.mjs";

const PAGES = { en: "site/src/content/docs/gate.mdx", ja: "site/src/content/docs/ja/gate.mdx" };
const read = (lang) => fs.readFileSync(path.join(ROOT, PAGES[lang]), "utf8").replace(/\r\n/g, "\n");
const inst = installs();

test("WEB-12: /gate and /ja/gate show exactly the installs GATE-1 and GATE-3 run (Express, Next.js, Workers)", () => {
  for (const lang of Object.keys(PAGES)) assert.deepEqual(gatePageProblems(read(lang), inst, lang), [], lang);
  const shown = RUNTIMES.map((r) => `${r.app} ${inst[r.app].diff.files.map((f) => `${f.file}+${f.added.filter((l) => l.trim()).length}`).join(" ")}`);
  console.log(`WEB-12: ${Object.keys(PAGES).length} languages × ${RUNTIMES.length} runtimes match the tested installs (${shown.join("; ")})`);
});

test("WEB-12: planted pages and a planted install are caught; the site's own id is the reader's", () => {
  const en = read("en"), ja = read("ja");
  const swap = (page, a, b) => { if (!page.includes(a)) throw new Error(`plant: ${a} not on the page`); return page.replace(a, b); };
  const planted = [
    ["the app.use line left out", swap(en, "app.use(await ludion());\n", ""), /does not show the installed line "app\.use/],
    ["the old package name", swap(en, 'export { proxy } from "ludion-ai/gate/next";', 'export { proxy } from "@ludion/gate-next";'), /next: the page shows a line the tested install does not have/],
    ["the name npm refused", swap(en, 'import { ludion } from "ludion-ai/gate/node";', 'import { ludion } from "ludion/gate/node";'), /express: the page shows a line the tested install does not have/],
    ["installing the name npm refused", swap(en, "npm install ludion-ai\n```\n\nAdd two lines", "npm install ludion\n```\n\nAdd two lines"), /express: the install command/],
    ["an extra line in the Worker", swap(en, "    // your Worker, unchanged\n", "    // your Worker, unchanged\n    ctx.waitUntil(flush());\n"), /workers: the page shows a line the tested install does not have: "ctx\.waitUntil/],
    ["a config typo", swap(en, '"pressure": 0', '"presure": 0'), /express: ludion\.config\.json on the page/],
    ["another install command", swap(en, "npm install ludion-ai\n```\n\nAdd two lines", "npm install @ludion/gate-node\n```\n\nAdd two lines"), /express: the install command/],
    ["the nodejs_compat flag left out", swap(en, 'compatibility_flags = ["nodejs_compat"]\n', ""), /does not show the installed line "compatibility_flags/],
    ["a config line the install does not have", swap(en, "[vars.LUDION]", "[vars.ludion]"), /wrangler\.toml shows a line the tested install does not have/],
    ["the Workers section gone", en.slice(0, en.indexOf("## Cloudflare Workers")) + en.slice(en.indexOf("## When you raise")), /en: 0 sections for workers/],
    ["the Japanese page behind", swap(ja, 'import { ludion } from "ludion-ai/gate/node";', 'import { ludion } from "@ludion/gate-node";'), /ja express/],
  ];
  const missed = planted.filter(([, page, why], i) => !gatePageProblems(page, inst, i === planted.length - 1 ? "ja" : "en").some((p) => why.test(p))).map(([n]) => n);
  assert.deepEqual(missed, []);
  console.log(`WEB-12 planted: ${planted.length - missed.length}/${planted.length} pages caught`);

  // The site's own id differs from the reference's on purpose.
  assert.deepEqual(gatePageProblems(swap(en, '"site_id": "site-your-shop"', '"site_id": "site-another-shop"'), inst, "en"), [], "control: another site_id");

  // A planted install: the reference Express install gains a line the page does not show.
  const ref = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-web12-"));
  try {
    for (const { app } of RUNTIMES) for (const d of ["site", "install"]) fs.cpSync(path.join(ROOT, "reference", app, d), path.join(ref, app, d), { recursive: true, filter: (p) => !p.includes("node_modules") });
    const server = path.join(ref, "express", "install", "server.mjs");
    fs.writeFileSync(server, fs.readFileSync(server, "utf8").replace("app.use(await ludion());\n", "app.use(await ludion());\napp.use(ludion.receipts());\n"));
    const problems = gatePageProblems(en, installs({ ref }), "en");
    assert.ok(problems.some((p) => /does not show the installed line "app\.use\(ludion\.receipts\(\)\);"/.test(p)), problems.join("\n"));
  } finally { fs.rmSync(ref, { recursive: true, force: true }); }
});
