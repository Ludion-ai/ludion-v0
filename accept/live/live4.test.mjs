// LIVE-4's judge bites: every way a response says "do not index" is caught, and a clean page is not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { robotsProblems, sitemapPages } from "./robots.mjs";

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><meta name="description" content="noindex is a word here"><title>x</title></head><body>noindex</body></html>';

test("LIVE-4: the judge catches noindex in a header or in the page, in each form; a clean page passes", () => {
  assert.deepEqual(robotsProblems({ "content-type": "text/html" }, PAGE), [], "control: a clean page (the word in a description or the body is not a directive)");
  assert.deepEqual(robotsProblems({ "x-robots-tag": "nofollow" }, PAGE), [], "control: another directive");
  const planted = [
    ["the header Cloudflare adds to version URLs", { "x-robots-tag": "noindex" }, PAGE],
    ["the header with several values", { "x-robots-tag": "nofollow, noindex" }, PAGE],
    ["the header for one bot", { "x-robots-tag": "googlebot: noindex" }, PAGE],
    ["the header saying none", { "x-robots-tag": "none" }, PAGE],
    ["the header, upper case", [["X-Robots-Tag", "NOINDEX"]], PAGE],
    ["a robots meta", {}, PAGE.replace("<title>", '<meta name="robots" content="noindex, nofollow"><title>')],
    ["a googlebot meta, single quotes", {}, PAGE.replace("<title>", "<meta name='googlebot' content='noindex'><title>")],
    ["a robots meta, content first", {}, PAGE.replace("<title>", '<meta content="noindex" name="robots"><title>')],
    ["a robots meta saying none", {}, PAGE.replace("<title>", '<meta name="robots" content="none"><title>')],
  ];
  const missed = planted.filter(([, h, html]) => robotsProblems(h, html).length === 0).map(([n]) => n);
  assert.deepEqual(missed, []);
  console.log(`LIVE-4 judge: ${planted.length}/${planted.length} planted caught, 2 controls clean`);
});

test("LIVE-4: the pages come from the sitemap index and its sitemaps", async () => {
  const files = {
    "https://x.test/sitemap-index.xml": "<sitemapindex><sitemap><loc>https://x.test/sitemap-0.xml</loc></sitemap></sitemapindex>",
    "https://x.test/sitemap-0.xml": "<urlset><url><loc>https://x.test/</loc></url><url><loc> https://x.test/ja/ </loc></url><url><loc>https://x.test/</loc></url></urlset>",
  };
  const fake = async (u) => (files[u] ? new Response(files[u]) : new Response("", { status: 404 }));
  assert.deepEqual(await sitemapPages("https://x.test", fake), ["https://x.test/", "https://x.test/ja/"]);
});
