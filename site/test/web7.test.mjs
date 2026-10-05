// WEB-7 (+, pair WEB-12): the launch docs' install steps run, on Node, Next.js and Cloudflare Workers
// (the human's decision, 2026-10-04: FastAPI, WordPress and Python are planned, after the launch).
// The page "Install the Gate" (site/src/content/docs/gate.mdx) is followed, section by section, on a
// reader's site that has not installed the Gate yet — reference/<app>/site, the same sites GATE-1 and
// GATE-3 start from:
//   - `npm install ludion-ai` is the packed tarball (as npm would fetch it), after the site's own `npm ci`;
//   - Express: "Add two lines to your server" — the import with the other imports, `app.use(…)` right
//     after the app is made (before its routes and body parsers);
//   - Next.js: "Create proxy.js in the project root", the config "the same as for Express", then
//     `next build && next start`;
//   - Workers: "Wrap your default export" — the import, `export default withLudion({`, and the closing
//     `});` — and the page's lines added to wrangler.toml; then `wrangler dev`.
// What the page says then happens: a person gets the page; an automated visit is classified, with a
// receipt (a crawler's name is DECLARED); and the server says so on its console, once (ONE-1).
// The quickstart's own run (Express and the CLI agent to VERIFIED) is WEB-10, signing from code WEB-13.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sections } from "./gate-page.mjs";
import { REF, ROOT, prepareFrom, start, freePort, stopAll, raw, receiptOf } from "../../reference/harness.mjs";

after(stopAll);
const PAGE = path.join(ROOT, "site/src/content/docs/gate.mdx");
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const GPTBOT = "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const FIRST_LINE = /ludion: recorded the first automated visit — DECLARED GPTBot/;

const lines = (code) => code.split("\n").filter((l) => l.trim());
const siteFile = (app, f) => fs.readFileSync(path.join(REF, app, "site", f), "utf8");

/** Insert `line` after the last top-level import, or before the first statement when there is none. */
function withImport(text, line) {
  const ls = text.split("\n");
  let at = -1;
  ls.forEach((l, i) => { if (/^import\s/.test(l)) at = i; });
  if (at < 0) at = ls.findIndex((l) => l.trim() && !l.startsWith("//")) - 1;
  ls.splice(at + 1, 0, line);
  return ls.join("\n");
}

/**
 * The reader's files after following the page's section for `app`: path → text. Throws when the page
 * does not say something the reader needs (a missing block or line).
 */
export function followPage(mdx, app) {
  const secs = sections(mdx);
  const of = (re) => {
    const s = secs.filter((x) => re.test(x.heading));
    if (s.length !== 1) throw new Error(`${s.length} sections for ${re}`);
    return s[0];
  };
  const express = of(/Express/), section = { express, next: of(/Next\.js/), workers: of(/Workers/) }[app];
  const block = (s, lang) => {
    const b = s.blocks.filter((x) => x.lang === lang);
    if (b.length !== 1) throw new Error(`${app}: ${b.length} ${lang} blocks`);
    return b[0].code;
  };
  if (block(section, "sh").trim() !== "npm install ludion-ai") throw new Error(`${app}: the install line is not npm install ludion-ai`);
  const config = block(express, "json"); // Next.js: "the same as for Express"
  if (app === "express") {
    const [imp, ...rest] = lines(block(section, "js"));
    if (!/^import\s/.test(imp) || rest.length !== 1) throw new Error("express: the page shows an import and one line");
    const server = siteFile("express", "server.mjs");
    if (!/^const app = express\(\);$/m.test(server)) throw new Error("express: the reader's server has no app to add the line to");
    return { "server.mjs": withImport(server, imp).replace(/^const app = express\(\);$/m, (m) => `${m}\n${rest[0]}`), "ludion.config.json": config };
  }
  if (app === "next") return { "proxy.js": block(section, "js"), "ludion.config.json": config };
  const js = lines(block(section, "js"));
  const imp = js.find((l) => /^import\s/.test(l)), open = js.find((l) => /^export default withLudion\(\{$/.test(l)), close = js[js.length - 1];
  if (!imp || !open || close !== "});") throw new Error("workers: the page shows the import, the wrapped export and its close");
  const worker = siteFile("workers", "src/index.js");
  if (!/^export default \{$/m.test(worker) || !/\n\};\s*$/.test(worker)) throw new Error("workers: the reader's Worker has no default export object to wrap");
  const wrapped = withImport(worker, imp).replace(/^export default \{$/m, open).replace(/\n\};(\s*)$/, `\n${close}$1`);
  return { "src/index.js": wrapped, "wrangler.toml": `${siteFile("workers", "wrangler.toml").trimEnd()}\n\n${block(section, "toml")}` };
}

const ask = (port, ua) => raw(port, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUser-Agent: ${ua}\r\nAccept: text/html\r\nConnection: close\r\n\r\n`);

const ran = {};
for (const app of ["express", "next", "workers"]) {
  test(`WEB-7: ${app}: the Install-the-Gate page, followed on a site without the Gate, runs — a person gets the page, a crawler's name is DECLARED, the console says so once`, { timeout: 900_000 }, async () => {
    const files = followPage(fs.readFileSync(PAGE, "utf8"), app);
    const dir = prepareFrom(app, files);
    const port = await freePort();
    const server = await start(app, dir, port, { logLevel: "log" }); // what a reader running wrangler dev sees
    try {
      const person = await ask(port, BROWSER);
      assert.equal(person.status, 200, "a person gets the page");
      assert.match(person.body.toString("utf8"), /Reference Shop/, "the site's own page");
      const crawler = await ask(port, GPTBOT);
      assert.equal(crawler.status, 200, "Pressure 0: it is let through");
      assert.equal(receiptOf(crawler)?.class, "DECLARED", `a receipt that classifies it: ${crawler.head}`);
      await ask(port, GPTBOT);
      const until = Date.now() + 30_000;
      while (!FIRST_LINE.test(server.log) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
      assert.match(server.log, FIRST_LINE, `the console says the first automated visit was recorded:\n${server.log.slice(-1500)}`);
      assert.equal(server.log.match(new RegExp(FIRST_LINE.source, "g")).length, 1, "once");
      ran[app] = Object.keys(files).join(", ");
    } finally { await server.stop(); }
  });
}

test("WEB-7: summary", () => {
  assert.deepEqual(Object.keys(ran).sort(), ["express", "next", "workers"]);
  console.log(`WEB-7: /gate followed on Express (${ran.express}), Next.js (${ran.next}) and Workers (${ran.workers}): a person gets the page, GPTBot's name is DECLARED, the first-visit line once`);
});
