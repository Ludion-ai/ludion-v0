// PUR-6 (−): the diver never sends a note with an email address, a phone number, a URL or a long
// number, or one over the length limit (80 characters with Japanese, 140 without) — spec §11.7.
// What it may say: what the agent will do on this site. A refused note stops the request before
// anything is signed or sent. The rule is tried on a planted lenient filter first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { noteProblem, purposeField, PurposeError, ludionFetch, createDiverSigner, generateEd25519 } from "../src/index.mjs";

const REFUSE = [
  ["an email", "Send the receipt to tanaka@example.com"],
  ["an email, full-width", "連絡先はｔａｎａｋａ＠ｅｘａｍｐｌｅ．ｃｏｍ"],
  ["a JP mobile", "Call 090-1234-5678 if out of stock"],
  ["a JP number, full-width", "電話は０３－１２３４－５６７８"],
  ["an international number", "Ring +44 20 7946 0958"],
  ["a card number", "Pay with 4242 4242 4242 4242"],
  ["an account number", "Account 12345678"],
  ["a postcode and street number", "Ship to 100-0001 1-1-1"],
  ["a URL", "Compare with https://other.example/item"],
  ["a URL without a scheme", "see www.other.example"],
  ["a host and path", "check other.example/item/42"],
  ["too long (en)", "a".repeat(141)],
  ["too long (ja)", "あ".repeat(81)],
  ["control characters", "line one\nline two"],
];
const ALLOW = [
  "Add one item to the cart for the user",
  "Compare prices and stock across 3 shops",
  "記事を読んで、利用者の質問に答える",
  "3店の価格と在庫を比べる",
  "カートに1点入れて購入する",
  "Book a table for 4 at 19:30",
  "a".repeat(140),
  "あ".repeat(80),
];

/** What the rule gets wrong on the corpus. */
function misses(rule) {
  const out = [];
  for (const [what, note] of REFUSE) if (!rule(note)) out.push(`sent ${what}`);
  for (const note of ALLOW) if (rule(note)) out.push(`refused ${JSON.stringify(note.slice(0, 30))}`);
  return out;
}

test("PUR-6: the judge catches a filter that lets personal details through, or refuses honest notes (planted)", () => {
  assert.ok(misses((n) => /@/.test(n)).length > 5, "an email-only filter misses phones, URLs and long numbers");
  assert.ok(misses((n) => /\d/.test(n)).some((m) => m.startsWith("refused")), "a no-digits filter refuses honest notes");
  assert.ok(misses(() => null).length === REFUSE.length, "no filter sends everything");
});

test("PUR-6: the diver refuses every personal detail and over-long note, and sends every honest one", () => {
  assert.deepEqual(misses(noteProblem), []);
  for (const [, note] of REFUSE) assert.throws(() => purposeField({ kind: "act", note }), PurposeError);
  for (const note of ALLOW) assert.match(purposeField({ kind: "act", note }), /^act;note=%"/);
  assert.throws(() => purposeField({ kind: "write" }), PurposeError, "only read or act");
  console.log(`PUR-6: ${REFUSE.length} notes with personal details or over the limit refused, ${ALLOW.length} honest ones sent; 0 misjudged`);
});

test("PUR-6: a refused note stops the request before anything is signed or sent", async () => {
  const s = await generateEd25519();
  const signer = await createDiverSigner({ sessionPrivateJwk: s.privateJwk, signatureAgent: "https://dvr-aaaaaaaaaaaaaaaa.agents.ludion.ai" });
  let sent = 0;
  const fetch = async () => { sent++; return new Response("ok"); };
  await assert.rejects(ludionFetch("https://shop.example/contact", { method: "POST", body: "{}", purpose: { kind: "act", note: "Call 090-1234-5678" } }, { signer, fetch }), PurposeError);
  assert.equal(sent, 0, "nothing left the agent");
  await ludionFetch("https://shop.example/contact", { method: "POST", body: "{}", purpose: { kind: "act", note: "Send one question" } }, { signer, fetch });
  assert.equal(sent, 1, "control: an honest note goes");
});
