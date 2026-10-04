// WEB-1 split over runners (LOOP-2, the human's decision 2026-10-04): Lighthouse on the preview takes
// about 9 minutes for every page, three runs each, so three runners each take a third of the pages,
// against the same version's own URL (it serves that build and nothing else). The job that judges
// WEB-1 then reads their results and holds them to this: each part exactly once, from this site and
// this URL, together every page exactly once, none below the threshold.

/** The pages of part i of n (1-based): every n-th page, so each part gets English and Japanese alike. */
export const partOf = (pages, i, n) => pages.filter((_, k) => k % n === i - 1);

/** "2/3" → { i: 2, n: 3 }, or a TypeError. */
export function parsePart(s) {
  const m = /^(\d+)\/(\d+)$/.exec(String(s ?? ""));
  const i = Number(m?.[1]), n = Number(m?.[2]);
  if (!m || n < 1 || i < 1 || i > n) throw new TypeError(`a part is i/n with 1 ≤ i ≤ n (got ${JSON.stringify(s)})`);
  return { i, n };
}

/**
 * What is wrong with the parts' results, as a whole WEB-1 Lighthouse verdict.
 * @param {{ site: string, url: string, part: string, pages: Record<string, { scores: Record<string, number>, failing: string[] }> }[]} parts
 * @param {{ site: string, url: string, pages: string[], min: number }} want
 * @returns {string[]}
 */
export function partsProblems(parts, want) {
  const out = [];
  if (!parts.length) return ["no part reported"];
  let n = null;
  const seenParts = new Set(), seenPages = new Map();
  for (const p of parts) {
    let part;
    try { part = parsePart(p.part); } catch (e) { out.push(e.message); continue; }
    if (n == null) n = part.n;
    if (part.n !== n) out.push(`parts of different splits (${p.part}, of ${n})`);
    if (seenParts.has(part.i)) out.push(`part ${p.part} reported twice`);
    seenParts.add(part.i);
    if (p.site !== want.site) out.push(`part ${p.part} measured site ${p.site}, not this build ${want.site}`);
    if (p.url !== want.url) out.push(`part ${p.part} measured ${p.url}, not ${want.url}`);
    for (const [page, r] of Object.entries(p.pages ?? {})) {
      seenPages.set(page, (seenPages.get(page) ?? 0) + 1);
      const scores = Object.values(r?.scores ?? {});
      if (scores.length < 4) out.push(`${page}: ${scores.length} of 4 scores`);
      for (const [k, v] of Object.entries(r?.scores ?? {})) if (!(v >= want.min)) out.push(`${page}: ${k} ${v} < ${want.min}`);
      for (const f of r?.failing ?? []) out.push(`${page}: ${f}`);
    }
  }
  if (n != null) for (let i = 1; i <= n; i++) if (!seenParts.has(i)) out.push(`part ${i}/${n} did not report`);
  for (const page of want.pages) if (!seenPages.has(page)) out.push(`${page} was not measured`);
  for (const [page, k] of seenPages) {
    if (!want.pages.includes(page)) out.push(`${page} is not a page of this build`);
    if (k > 1) out.push(`${page} measured ${k} times`);
  }
  return out;
}
