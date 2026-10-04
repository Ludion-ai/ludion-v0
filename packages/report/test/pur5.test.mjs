// PUR-5 (−): an agent's note, wherever the report shows it, is escaped and nothing in it becomes a
// link — not in the HTML, not where a mail client would autolink plain text — and it is labelled as
// the agent's own words, unchecked (spec §11.7). Tried on a planted renderer that skips the guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, defang } from "../src/summarize.mjs";
import { renderHtml, renderText } from "../src/render.mjs";

const HOSTILE = [
  '<script>alert(1)</script> read the page',
  '<a href="https://evil.example/x">click</a>',
  "Compare at https://evil.example/deal?ref=1",
  "javascript:alert(document.cookie)",
  "mail offers@evil.example now",
  "go to www.evil.example",
  "see evil.example/path for more",
  '" onmouseover="alert(1)',
];

const ev = (note, i) => ({ site: "s", ts: Date.parse("2026-09-29T03:00:00Z") + i * 1000, method: "POST", route: "/contact", class: "VERIFIED",
  decision: "allow", pressure: 0, diver: "https://reader.agent.example", operator: "reader.agent.example", contradiction: true, note });

/** What is wrong with a rendering of hostile notes. */
export function problems(html, text) {
  const out = [];
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/gi)].map((m) => m[1]);
  for (const l of links) if (l !== "https://ludion.ai/gate") out.push(`a link: ${l}`);
  if (/<script/i.test(html)) out.push("a script element");
  if (/<[^>]*\son\w+\s*=/i.test(html)) out.push("an event handler attribute");
  for (const [where, s] of [["html", html], ["text", text]]) {
    if (/https?:\/\/evil|evil\.example|www\.evil|offers@|javascript:/i.test(s)) out.push(`${where}: a live address`);
  }
  if (!text.includes("unchecked") && !text.includes("確かめていない")) out.push("not labelled as the agent's own words");
  return out;
}

test("PUR-5: the judge catches a report that shows a note as it came (planted)", () => {
  const raw = HOSTILE.join(" ");
  const html = `<p>${raw}</p><a href="https://ludion.ai/gate">Ludion</a><img src=x onerror="alert(1)">`, text = raw;
  assert.ok(problems(html, text).length >= 4, problems(html, text).join("; "));
});

test("PUR-5: hostile notes are escaped and defanged in HTML and text, in English and Japanese, and labelled unchecked", () => {
  // In batches the report shows whole (it lists the top five), so every hostile note is rendered.
  for (const batch of [HOSTILE.slice(0, 4), HOSTILE.slice(4)]) {
    const s = summarize(batch.map(ev), { site: "s", date: "2026-09-29", tz: "UTC" });
    assert.equal(s.said_vs_did.length, batch.length, "every note in the batch is shown");
    assert.ok(s.said_vs_did.every((x) => x.note === defang(x.note)), "the summary holds the defanged sentence, never the raw one");
    for (const lang of ["en", "ja"]) {
      const html = renderHtml(s, lang), text = renderText(s, lang);
      assert.deepEqual(problems(html, text), [], lang);
    }
  }
  console.log(`PUR-5: ${HOSTILE.length} hostile notes — scripts, links, schemes, addresses — show escaped, defanged and labelled unchecked in HTML and text (en, ja); 0 links but the report's own`);
});
