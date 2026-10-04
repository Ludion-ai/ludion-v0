// LIVE-4's judge: does a page tell search engines not to index it? WEB-1 measures preview versions
// through a relay that removes Cloudflare's `X-Robots-Tag: noindex` from version URLs (the human's
// approval, 2026-10-04, on condition that production is shown separately not to send it). This is that
// separate showing: on ludion.ai, no page says noindex — not in a header, not in the page.

const NOINDEX = /(^|[\s,:;])(noindex|none)([\s,;]|$)/i;

/**
 * What says "do not index" about one response.
 * @param {Headers|Record<string,string>|[string,string][]} headers
 * @param {string} html
 * @returns {string[]}
 */
export function robotsProblems(headers, html) {
  const out = [];
  const list = headers instanceof Headers ? [...headers] : Array.isArray(headers) ? headers : Object.entries(headers ?? {});
  for (const [k, v] of list) {
    // X-Robots-Tag may repeat, may name a bot ("googlebot: noindex"), may list several values.
    if (k.toLowerCase() === "x-robots-tag") for (const part of String(v).split(/,(?=\s*[a-z-]+\s*:)|\n/i)) if (NOINDEX.test(part)) out.push(`X-Robots-Tag: ${v}`);
  }
  for (const m of String(html ?? "").matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /\bname\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*([^\s>]+)/i.exec(tag)?.[1];
    if ((name === "robots" || name === "googlebot" || name === "bingbot") && content && NOINDEX.test(content)) out.push(`<meta name="${name}" content="${content}">`);
  }
  return [...new Set(out)];
}

/** The page URLs a sitemap (or a sitemap index) lists, following one level of index. */
export async function sitemapPages(origin, fetchImpl = fetch) {
  const text = async (u) => { const r = await fetchImpl(u, { cache: "no-store" }); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.text(); };
  const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const index = await text(`${origin}/sitemap-index.xml`);
  const out = [];
  for (const sm of locs(index)) out.push(...locs(await text(sm)));
  return [...new Set(out)];
}
