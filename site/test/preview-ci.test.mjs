// The preview in CI (LOOP-2, the human's decision 2026-10-04): which runs deploy it, where a version's
// own URL comes from, and how WEB-1's Lighthouse half is split over runners and judged as a whole.
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewNeeded, PREVIEW_INPUTS } from "../changed.mjs";
import { previewUrls } from "../deploy.mjs";
import { partOf, parsePart, partsProblems } from "./web1-parts.mjs";

test("preview: a push to main always deploys; a pull request only when it touches what the site is built from", () => {
  assert.equal(previewNeeded({ event: "push", files: [] }), true);
  for (const f of ["site/src/content/docs/gate.mdx", "site/deploy.mjs", "site/edge/wrangler.json", "packages/scan/src/core.mjs", "packages/gate-core/src/route.mjs", "packages/gate-core/src/agents.mjs", ".github/workflows/ci.yml"]) {
    assert.equal(previewNeeded({ event: "pull_request", files: ["README.md", f] }), true, f);
  }
  for (const f of ["README.md", "packages/gate-core/src/index.mjs", "docs/STATE.md", "accept/registry.mjs", "packages/scan/README.md", "sitemap.txt", ".github/workflows/release.yml"]) {
    assert.equal(previewNeeded({ event: "pull_request", files: [f] }), false, f);
  }
  assert.ok(PREVIEW_INPUTS.includes("site/"));
});

test("preview: the version's own URL, from wrangler deploy and from wrangler versions upload", () => {
  assert.deepEqual(previewUrls("Uploaded ludion-site-preview (3.2 sec)\nDeployed ludion-site-preview triggers (0.4 sec)\n  https://ludion-site-preview.ludion-agents.workers.dev\nCurrent Version ID: 0123abcd-1111-2222-3333-444455556666"),
    { url: "https://ludion-site-preview.ludion-agents.workers.dev", version: "0123abcd-1111-2222-3333-444455556666", versionUrl: "https://0123abcd-ludion-site-preview.ludion-agents.workers.dev" });
  assert.deepEqual(previewUrls("Worker Version ID: 9f8e7d6c-1111-2222-3333-444455556666\nUploaded ludion-site-preview\nVersion Preview URL: https://9f8e7d6c-ludion-site-preview.ludion-agents.workers.dev"),
    { url: null, version: "9f8e7d6c-1111-2222-3333-444455556666", versionUrl: "https://9f8e7d6c-ludion-site-preview.ludion-agents.workers.dev" });
  assert.equal(previewUrls("Deployed other-worker\n  https://other-worker.x.workers.dev").versionUrl, null, "another Worker's URL is not the preview's");
});

const PAGES = ["/", "/ja", "/gate", "/ja/gate", "/scan", "/ja/scan", "/e/x"];
const SITE = "abc123", URL = "https://0123abcd-ludion-site-preview.x.workers.dev";
const ok = (page) => ({ scores: { performance: 99, accessibility: 100, "best-practices": 100, seo: 100 }, failing: [] });
const parts = (n = 3) => Array.from({ length: n }, (_, k) => ({ site: SITE, url: URL, part: `${k + 1}/${n}`, pages: Object.fromEntries(partOf(PAGES, k + 1, n).map((p) => [p, ok(p)])) }));

test("WEB-1 parts: the split covers every page exactly once; the judge accepts the parts of a whole run", () => {
  assert.deepEqual([1, 2, 3].flatMap((i) => partOf(PAGES, i, 3)).sort(), [...PAGES].sort());
  assert.deepEqual(parsePart("2/3"), { i: 2, n: 3 });
  for (const bad of ["0/3", "4/3", "x", "", null]) assert.throws(() => parsePart(bad));
  assert.deepEqual(partsProblems(parts(), { site: SITE, url: URL, pages: PAGES, min: 95 }), []);
});

test("WEB-1 parts: a missing part, a page twice or not at all, another build or URL, a low score are caught", () => {
  const want = { site: SITE, url: URL, pages: PAGES, min: 95 };
  const planted = [
    ["a part that did not report", () => parts().slice(0, 2), /part 3\/3 did not report/],
    ["a part reported twice", () => [...parts(), parts()[0]], /reported twice/],
    ["a page not measured", () => { const p = parts(); delete p[0].pages["/"]; return p; }, /\/ was not measured/],
    ["a page measured twice", () => { const p = parts(); p[1].pages["/"] = ok("/"); return p; }, /\/ measured 2 times/],
    ["another build", () => { const p = parts(); p[2].site = "other"; return p; }, /not this build/],
    ["another URL (the live one, which may have moved on)", () => { const p = parts(); p[1].url = "https://ludion-site-preview.x.workers.dev"; return p; }, /measured https:\/\/ludion-site-preview/],
    ["a score below the bar", () => { const p = parts(); p[0].pages["/"].scores.performance = 94; return p; }, /\/: performance 94 < 95/],
    ["a page that is not in the build", () => { const p = parts(); p[0].pages["/old"] = ok("/old"); return p; }, /\/old is not a page of this build/],
    ["parts of different splits", () => { const p = parts(); p[2].part = "3/4"; return p; }, /different splits/],
    ["nothing", () => [], /no part reported/],
  ];
  const missed = planted.filter(([, make, why]) => !partsProblems(make(), want).some((x) => why.test(x))).map(([n]) => n);
  assert.deepEqual(missed, []);
});

test("relay: the version's responses byte for byte — status, headers, a gzip body — less exactly X-Robots-Tag: noindex", async () => {
  const { previewRelay } = await import("./relay.mjs");
  const http = await import("node:http");
  const zlib = await import("node:zlib");
  const page = zlib.gzipSync(Buffer.from("<!doctype html><title>x</title>".repeat(50)));
  const upstream = http.createServer((req, res) => {
    if (req.url === "/missing") return res.writeHead(404, { "content-type": "text/html", "x-robots-tag": "noindex" }).end("nope");
    if (req.url === "/kept") return res.writeHead(200, { "x-robots-tag": "nofollow" }).end("k");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip", "cache-control": "public, max-age=0, must-revalidate", "x-robots-tag": "noindex" }).end(page);
  });
  await new Promise((ok) => upstream.listen(0, "127.0.0.1", ok));
  const relay = await previewRelay(`http://127.0.0.1:${upstream.address().port}`);
  try {
    const get = (p) => new Promise((ok, no) => http.get(`${relay.url}${p}`, { headers: { "accept-encoding": "gzip" } }, (r) => {
      const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => ok({ status: r.statusCode, headers: r.headers, body: Buffer.concat(c) }));
    }).on("error", no));
    const a = await get("/");
    assert.equal(a.status, 200);
    assert.ok(a.body.equals(page), "the compressed bytes, untouched");
    assert.equal(a.headers["content-encoding"], "gzip");
    assert.equal(a.headers["cache-control"], "public, max-age=0, must-revalidate");
    assert.equal(a.headers["x-robots-tag"], undefined, "noindex removed");
    const b = await get("/missing");
    assert.equal(b.status, 404);
    assert.equal(b.body.toString(), "nope");
    assert.equal((await get("/kept")).headers["x-robots-tag"], "nofollow", "any other robots value stays");
    assert.equal(relay.removed(), 2);
  } finally { await relay.close(); upstream.close(); }
});
