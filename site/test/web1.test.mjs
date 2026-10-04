// WEB-1 (+, pair WEB-5): the site is deployed to the Cloudflare preview (site/preview.json, written by
// `npm run deploy:preview`), and what the preview serves is THIS checkout's build: its _build.json is
// this checkout's siteHash(), and every page's bytes equal the local build's. Every page exists in
// English and Japanese, and every page ON THE PREVIEW scores Lighthouse mobile ≥95 in Performance,
// Accessibility, Best Practices and SEO.
//
// It checks the version's own preview URL when there is one (https://<version>-ludion-site-preview…):
// that URL serves that build and nothing else, so another run deploying meanwhile cannot change what
// is measured. In CI the Lighthouse half is split over runners (LOOP-2): with LUDION_WEB1_PART=i/n a
// runner measures its part and writes LUDION_WEB1_OUT; with LUDION_WEB1_PARTS=<dir> the judging job
// measures nothing and holds the parts to web1-parts.mjs (every page exactly once, this site, this URL).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { SITE, buildSite, siteHash } from "../build.mjs";
import { lighthouseRunner, MIN_SCORE } from "./lighthouse.mjs";
import { pairing, htmlFiles, urlOf } from "./pages.mjs";
import { partOf, parsePart, partsProblems } from "./web1-parts.mjs";
import { previewRelay, liveRobotsTag } from "./relay.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const PART = process.env.LUDION_WEB1_PART, PARTS = process.env.LUDION_WEB1_PARTS;
let preview, url, dist, lh;
before(async () => {
  const file = path.join(SITE, "preview.json");
  assert.ok(fs.existsSync(file), "site/preview.json is missing: run `npm run deploy:preview`");
  preview = JSON.parse(fs.readFileSync(file, "utf8"));
  url = preview.version_url ?? preview.url;
  dist = buildSite();
});
after(async () => { await lh?.close(); });

test("WEB-1: the preview is a workers.dev URL and serves this checkout's build", async () => {
  assert.match(preview.url, /^https:\/\/ludion-site-preview\.[a-z0-9-]+\.workers\.dev$/);
  if (preview.version_url) assert.equal(preview.version_url, preview.url.replace("https://ludion-site-preview.", `https://${preview.version.slice(0, 8)}-ludion-site-preview.`), "the version's own URL, on the preview Worker");
  const r = await fetch(`${url}/_build.json`, { cache: "no-store" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).site, siteHash(), "the preview is stale: run `npm run deploy:preview`");
});

test("WEB-1: every page on the preview is byte-identical to the local build, in English and Japanese", async () => {
  const p = pairing(dist);
  assert.deepEqual(p.problems, []);
  const diffs = [];
  for (const f of htmlFiles(dist)) {
    const r = await fetch(url + urlOf(f), { cache: "no-store" });
    const body = Buffer.from(await r.arrayBuffer());
    if (r.status !== 200) diffs.push(`${urlOf(f)} → ${r.status}`);
    else if (sha(body) !== sha(fs.readFileSync(path.join(dist, f)))) diffs.push(`${urlOf(f)} differs from the build`);
  }
  assert.deepEqual(diffs, []);
});

test("WEB-1: Lighthouse mobile ≥95 in all four categories on every page of the preview", { timeout: 1_700_000 }, async () => {
  const pages = htmlFiles(dist).map(urlOf);
  if (PARTS) {
    // The judging job: the parts' results, held to every page exactly once from this build and URL.
    const parts = fs.readdirSync(PARTS).filter((f) => /^web1-part-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(PARTS, f), "utf8")));
    assert.deepEqual(partsProblems(parts, { site: siteHash(), url, pages, min: MIN_SCORE }), []);
    const low = Math.min(...parts.flatMap((p) => Object.values(p.pages).flatMap((r) => Object.values(r.scores))));
    console.log(`WEB-1: ${url}; ${pages.length} pages (en + ja) over ${parts.length} runners, lowest median score ${low} (3 runs each)`);
    return;
  }
  const mine = PART ? partOf(pages, parsePart(PART).i, parsePart(PART).n) : pages;
  // A version URL carries Cloudflare's X-Robots-Tag: noindex, which the live preview does not send
  // (relay.mjs): measured through a relay that removes exactly that, once the live URL is shown clean.
  let measured = url, relay = null;
  if (preview.version_url && url === preview.version_url) {
    assert.equal(await liveRobotsTag(preview.url), null, "the live preview sends no X-Robots-Tag, so the version URL's is the only one removed");
    relay = await previewRelay(url);
    measured = relay.url;
  }
  lh = await lighthouseRunner();
  const results = {}, failing = [];
  try {
    for (const page of mine) {
      const r = await lh.auditMedian(measured + page, 3); // the median of three runs per page
      results[page] = { scores: r.scores, failing: r.failing };
      for (const x of r.failing) failing.push(`${page}: ${x}`);
    }
  } finally { await relay?.close(); }
  if (PART && process.env.LUDION_WEB1_OUT) fs.writeFileSync(process.env.LUDION_WEB1_OUT, JSON.stringify({ site: siteHash(), url, part: PART, pages: results }, null, 2));
  assert.deepEqual(failing, [], `below ${MIN_SCORE}`);
  const low = Math.min(...Object.values(results).flatMap((r) => Object.values(r.scores)));
  console.log(`WEB-1${PART ? ` part ${PART}` : ""}: ${url}; ${mine.length} pages (en + ja), lowest median score ${low} (3 runs each)`);
});
