// MSG-1 (±): the launch copy says the three questions and what Ludion does not prevent, and claims no
// more (lane 2 spec §3.6, §4). Read: the README's opening (English and Japanese: everything before its
// second section, so "What Ludion does not prevent" sits right under the three questions), the top page
// (both languages), and the Show HN and thread-answer drafts.
//   - the three questions: who is this AI, what may it do, how is it stopped;
//   - "What Ludion does not prevent", with the spec's three: v0's Mandate is the operator's limit and not
//     the person's consent; only a site with a Gate stops it; a stolen Root key can issue new Mandates;
//   - no overclaim (unhackable, bulletproof, prevents breaches, 100% secure, 絶対に, 完全に防ぐ, …);
//   - the census link in the Show HN first comment; the three new thread answers (allowlist, the browser,
//     prompt-injection detection).
// The other side: planted copies — an overclaim, a question gone, the section gone or moved down, a
// caveat dropped, the census link moved into the post — are each caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/** The README's opening: everything before its second "## " section. */
export function opening(md) {
  const heads = [...md.matchAll(/^## /gm)].map((m) => m.index);
  return heads.length >= 2 ? md.slice(0, heads[1]) : md;
}

const EN = {
  questions: [["who is this AI", /who is this AI/i], ["what may it do", /what may it do/i], ["how is it stopped", /how (is it|do you) stop/i]],
  section: /what Ludion does not prevent/i,
  caveats: [["the operator's limit, not the person's consent", /not the consent/i], ["only a site with a Gate", /(site|one) without (a Gate|one)/i], ["a stolen Root key", /steals? the Root key/i]],
};
const JA = {
  questions: [["この AI は誰か", /この AI は誰か/], ["何をしていいのか", /何をしていいのか/], ["どう止めるのか", /どう止めるのか/]],
  section: /Ludion が防がないもの/,
  caveats: [["運営者の上限で、同意ではない", /同意では(ない|ありません)/], ["Gate のあるサイトだけ", /Gate の無いサイト/], ["Root 鍵の盗難", /Root 鍵まで盗まれる/]],
};
/** Words that claim more than Ludion does (spec §14, lane 2 spec §4). Any case, anywhere. */
export const OVERCLAIMS = [
  /un-?hackable/i, /bullet-?proof/i, /prevents? (all )?breaches/i, /100\s*% (secure|safe)/i, /fully secure/i, /completely (secure|safe)/i,
  /fool-?proof/i, /(can ?not|can't|never) be hacked/i, /impossible to (hack|breach|bypass)/i, /military[- ]grade/i, /zero risk/i, /guaranteed (safe|secure)/i,
  /絶対に/, /絶対安全/, /完全に(防|守)/, /100\s*[%％]\s*安全/, /必ず防/, /ハッキングされない/, /破られない/,
];

/** What is wrong with one piece of copy. */
export function copyProblems(name, text, lang) {
  const L = lang === "ja" ? JA : EN;
  const out = [];
  for (const [q, re] of L.questions) if (!re.test(text)) out.push(`${name}: no "${q}"`);
  const at = text.search(L.section);
  if (at < 0) out.push(`${name}: no "${lang === "ja" ? "Ludion が防がないもの" : "What Ludion does not prevent"}"`);
  else for (const [c, re] of L.caveats) if (!re.test(text.slice(at))) out.push(`${name}: what it does not prevent leaves out "${c}"`);
  for (const re of OVERCLAIMS) { const m = re.exec(text); if (m) out.push(`${name}: says "${m[0]}"`); }
  return out;
}

/** The pieces MSG-1 reads, from the working tree (or planted copies). */
export function pieces(over = {}) {
  const f = (k, file) => over[k] ?? read(file);
  return [
    ["README.md (opening)", opening(f("readme", "README.md")), "en"],
    ["README.ja.md (opening)", opening(f("readmeJa", "README.ja.md")), "ja"],
    ["top page", f("top", "site/src/content/docs/index.mdx"), "en"],
    ["top page (ja)", f("topJa", "site/src/content/docs/ja/index.mdx"), "ja"],
    ["show-hn.md", f("showHn", "docs/outbox/launch/show-hn.md"), "en"],
    ["faq.md", f("faq", "docs/outbox/launch/faq.md"), "en"],
  ];
}

/** Everything MSG-1 asks of the copy. */
export function msgProblems(over = {}) {
  const out = pieces(over).flatMap(([name, text, lang]) => copyProblems(name, text, lang));
  const hn = over.showHn ?? read("docs/outbox/launch/show-hn.md");
  const first = hn.split(/\*\*First comment/)[1] ?? "";
  if (!/ludion\.ai\/census/.test(first)) out.push("show-hn.md: the census link is not in the first comment");
  const faq = over.faq ?? read("docs/outbox/launch/faq.md");
  // A question is a bold line of its own.
  const questions = [...faq.matchAll(/^\*\*([^*\n]+)\*\*$/gm)].map((m) => m[1]);
  for (const [q, re] of [["an allowlist", /allowlist/i], ["AI inside the user's browser", /browser/i], ["prompt-injection detection", /detect prompt injection/i]]) {
    if (!questions.some((x) => re.test(x))) out.push(`faq.md: no question about ${q}`);
  }
  return out;
}

test("MSG-1: the README's opening, the top page, Show HN and the thread answers say the three questions and what Ludion does not prevent, and overclaim nothing", () => {
  assert.deepEqual(msgProblems(), []);
  console.log(`MSG-1: ${pieces().length} pieces of copy, 3 questions and 3 caveats each, 0 of ${OVERCLAIMS.length} overclaims; census in the first comment; 3 new thread answers`);
});

test("MSG-1: the check bites — planted copy is caught", () => {
  const readme = read("README.md"), top = read("site/src/content/docs/index.mdx"), topJa = read("site/src/content/docs/ja/index.mdx");
  const hn = read("docs/outbox/launch/show-hn.md"), faq = read("docs/outbox/launch/faq.md");
  const section = /## What Ludion does not prevent[\s\S]*?(?=\n## )/.exec(readme)[0];
  const planted = [
    ["an overclaim in the README", { readme: readme.replace("Identity, limits", "Unhackable identity, limits") }],
    ["\"100% secure\" on the top page", { top: `${top}\nAgents are 100% secure.\n` }],
    ["\"絶対に\" on the Japanese top page", { topJa: `${topJa}\n絶対に止まります。\n` }],
    ["\"prevents breaches\" in the post", { showHn: hn.replace("AI agents now read", "Ludion prevents breaches. AI agents now read") }],
    ["a question gone", { top: top.replace(/what may it do/gi, "what it does") }],
    ["the section gone", { faq: faq.replace("what does Ludion not prevent", "what does Ludion add").replace("What Ludion does not prevent", "Also") }],
    ["the section moved below the README's opening", { readme: readme.replace(section, "").replace("## Where things stand", `${section.trim()}\n\n## Where things stand`) }],
    ["a caveat dropped (the Root key)", { topJa: topJa.replace(/- Root 鍵まで盗まれると[^\n]*\n/, "") }],
    ["the census link moved into the post", { showHn: hn.replace(/\nhttps:\/\/ludion\.ai\/census[^\n]*/, "").replace("**Text**\n", "**Text**\n\nSee https://ludion.ai/census.\n") }],
    ["the browser question gone", { faq: faq.replace("**Can it protect AI that runs inside the user's own browser?**", "**Does it work everywhere?**") }],
  ];
  const missed = planted.filter(([, over]) => msgProblems(over).length === 0).map(([what]) => what);
  assert.deepEqual(missed, [], "every planted copy is caught");
  console.log(`MSG-1 planted: ${planted.length}/${planted.length} caught`);
});
