// The site Worker's two answers for `npx ludion init` (DIV-5, DIV-6): POST /api/init-answer takes one
// word and nothing else; GET /badge/<diver_id>.svg draws the id it is asked for, and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleInitAnswer, ANSWERS, INIT_ANSWER_ENDPOINT } from "../edge/init-answer.mjs";
import { badgeResponse } from "../edge/badge.mjs";
import worker from "../edge/worker.mjs";

const open = { take: () => 0 };
const post = (body, type = "application/json") => new Request(`https://ludion.ai${INIT_ANSWER_ENDPOINT}`, { method: "POST", headers: { "content-type": type }, body });

test("init-answer: one of the four words reaches the notifier as one line; nothing else is accepted", async () => {
  for (const answer of ANSWERS) {
    const sent = [];
    const r = await handleInitAnswer(post(JSON.stringify({ answer })), { webhook: "https://hooks.example/x", limiter: open, fetch: async (u, i) => { sent.push(JSON.parse(i.body)); return new Response(null, { status: 204 }); } });
    assert.equal(r.status, 204, answer);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, `ludion init: ${answer}`);
    assert.equal(JSON.stringify(sent[0]).includes("dvr-"), false);
  }
  const refused = [
    [JSON.stringify({ answer: "mcp", diver: "dvr-aaaaaaaaaaaaaaaa" }), 400], [JSON.stringify({ answer: "other stuff" }), 400],
    [JSON.stringify(["mcp"]), 400], ["not json", 400], [JSON.stringify({ answer: "mcp", pad: "x".repeat(300) }), 413],
  ];
  for (const [body, status] of refused) {
    const sent = [];
    const r = await handleInitAnswer(post(body), { webhook: "https://hooks.example/x", limiter: open, fetch: async () => { sent.push(1); return new Response(null); } });
    assert.equal(r.status, status, body.slice(0, 40));
    assert.equal(sent.length, 0, "nothing refused reaches the notifier");
  }
  assert.equal((await handleInitAnswer(post("answer=mcp", "application/x-www-form-urlencoded"), { webhook: "h", limiter: open })).status, 415);
  assert.equal((await handleInitAnswer(new Request("https://ludion.ai/api/init-answer"), { webhook: "h", limiter: open })).status, 405);
  assert.equal((await handleInitAnswer(post(JSON.stringify({ answer: "web" })), { limiter: open })).status, 503, "no notifier: not taken");
  assert.equal((await handleInitAnswer(post(JSON.stringify({ answer: "web" })), { webhook: "h", limiter: { take: () => 30 } })).headers.get("retry-after"), "30");
});

test("badge: a Diver id is drawn as itself; anything else is 404; other paths are not the badge's", async () => {
  const r = badgeResponse("/badge/dvr-k7q2m6x4pcab3cde.svg");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^image\/svg\+xml/);
  const svg = await r.text();
  assert.match(svg, /dvr-k7q2m6x4pcab3cde/);
  assert.match(svg, /Ludion ID/);
  for (const bad of ["/badge/dvr-K7Q2M6X4PCAB3CDE.svg", "/badge/dvr-short.svg", "/badge/<script>.svg", "/badge/dvr-k7q2m6x4pcab3cde0.svg", "/badge/..%2Fx.svg"]) {
    assert.equal(badgeResponse(bad).status, 404, bad);
  }
  assert.equal(badgeResponse("/scan"), null);
  assert.equal(badgeResponse("/badge/dvr-k7q2m6x4pcab3cde.png"), null);
});

test("worker: /api/init-answer and /badge/… are answered by the Worker; everything else goes to the static files", async () => {
  const env = { ASSETS: { fetch: async () => new Response("static") }, SIGNUP_WEBHOOK_URL: undefined };
  assert.equal((await worker.fetch(post(JSON.stringify({ answer: "mcp" })), env)).status, 503);
  assert.equal((await worker.fetch(new Request("https://ludion.ai/badge/dvr-k7q2m6x4pcab3cde.svg"), env)).status, 200);
  assert.equal(await (await worker.fetch(new Request("https://ludion.ai/scan"), env)).text(), "static");
});
