#!/usr/bin/env node
// LIVE-4 (L2, nightly): production ludion.ai serves the new site and no page of it says noindex —
// neither an X-Robots-Tag header nor a robots <meta>. The condition the human set (2026-10-04) for WEB-1
// measuring preview versions through a relay that removes Cloudflare's noindex on version URLs.
// Before the cutover (ludion.ai not serving a build of site/), it fails and says so.
import { robotsProblems, sitemapPages } from "./robots.mjs";

const ORIGIN = process.env.LUDION_PRODUCTION_ORIGIN ?? "https://ludion.ai";
const get = (u) => fetch(u, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(30_000) });

try {
  const b = await get(`${ORIGIN}/_build.json`);
  const build = b.ok ? (await b.json().catch(() => null))?.site : null;
  if (!/^[0-9a-f]{16}$/.test(build ?? "")) { console.log(`FAIL: ${ORIGIN} does not serve a build of site/ (no /_build.json): the cutover is the human's (docs/DEPLOY.md §3)`); process.exit(1); }
  const pages = await sitemapPages(ORIGIN);
  if (pages.length < 10) { console.log(`FAIL: the sitemap lists ${pages.length} pages`); process.exit(1); }
  const problems = [];
  for (const page of [`${ORIGIN}/`, ...pages, `${ORIGIN}/no-such-page-live4`]) {
    const r = await get(page);
    const html = await r.text();
    if (page.endsWith("no-such-page-live4") ? r.status !== 404 : r.status !== 200) problems.push(`${page} → ${r.status}`);
    for (const p of robotsProblems(r.headers, html)) problems.push(`${page}: ${p}`);
  }
  if (problems.length) { console.log(`FAIL: ${problems.slice(0, 10).join("; ")}`); process.exit(1); }
  console.log(`# LIVE-4: ${ORIGIN} serves build ${build}; ${pages.length} sitemap pages, the home and a 404: none says noindex (header or meta)`);
} catch (e) { console.log(`FAIL: cannot read ${ORIGIN}: ${e.message}`); process.exit(1); }
