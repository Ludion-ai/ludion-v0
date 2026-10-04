// DIV-5 (±): `npx ludion init` shows one screen (spec §9.2, §13.1): the AI's name; the same name on the
// web (Signature-Agent) and on MCP (client_id); the line that erases it; a README badge. Nothing frozen
// (Depth, Ballast, Mandate, Pressure, Staple) and no secret is on it. English, Japanese, a custom domain.
// DIV-6 (−): the one optional question sends nothing unless answered. Not at a terminal, in CI, skipped
// or answered with nonsense: zero network attempts (the SCAN-3 trap). Answered: one POST, one word, no
// identity (no Diver id, name, contact or key).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FROZEN_WORDS, shouldAsk, parseAnswer, ANSWERS } from "../src/init-screen.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../bin/ludion.mjs");
const TRAP = pathToFileURL(path.resolve(HERE, "../../scan/test/no-network.mjs")).href;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ludion-div5-"));

function init(args, { env = {}, input = "", trap = false } = {}) {
  const cwd = tmp(), log = path.join(cwd, "..", `net-${path.basename(cwd)}.log`);
  fs.writeFileSync(log, "");
  const r = spawnSync(process.execPath, [...(trap ? ["--import", TRAP] : []), CLI, "init", "--dev", ...args], {
    cwd, input, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, CI: "", LANG: "en_US.UTF-8", LC_ALL: "", LC_MESSAGES: "", LUDION_NET_TRAP: log, ...env },
  });
  const store = fs.existsSync(path.join(cwd, "ludion.json")) ? JSON.parse(fs.readFileSync(path.join(cwd, "ludion.json"), "utf8")) : null;
  const net = fs.readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("attempt"));
  return { ...r, store, net };
}

/** What is wrong with init's screen (its stdout), for the identity it made. */
export function screenProblems(out, { id, origin, lang = "en" }) {
  const p = [];
  const lines = out.split("\n");
  const first = lang === "ja" ? `あなたの AI の名前：${origin}` : `Your AI's name: ${origin}`;
  if (lines[0] !== first) p.push(`first line ${JSON.stringify(lines[0])}`);
  const screen = lines.slice(0, 8).join("\n");
  if (!screen.includes(`Signature-Agent: sig1="${origin}"`)) p.push("no Web line");
  if (!screen.includes(`client_id = ${origin}/card`)) p.push("no MCP line");
  if (!/npx ludion revoke/.test(screen)) p.push("no revoke line");
  if (!(lang === "ja" ? /1時間以内に、世界中で通らなくなります/ : /within 1 hour, it stops working everywhere/).test(screen)) p.push("no erase promise");
  if (!screen.includes(`[![Ludion ID](https://ludion.ai/badge/${id}.svg)](${origin})`)) p.push("no badge");
  for (const w of FROZEN_WORDS) if (new RegExp(`\\b${w}\\b`, "i").test(out)) p.push(`frozen word ${w}`);
  if (/"d"\s*:|BEGIN [A-Z ]*PRIVATE KEY/.test(out)) p.push("a secret");
  return p;
}

test("DIV-5: the checker catches a screen that is not the one screen (planted)", () => {
  const id = "dvr-aaaaaaaaaaaaaaaa", origin = `https://${id}.agents.ludion.ai`;
  const good = [`Your AI's name: ${origin}`, "", `  Web    Signature-Agent: sig1="${origin}"`, `  MCP    client_id = ${origin}/card`,
    "  Erase  npx ludion revoke   (within 1 hour, it stops working everywhere)", "", "  README badge:", `  [![Ludion ID](https://ludion.ai/badge/${id}.svg)](${origin})`].join("\n");
  assert.deepEqual(screenProblems(good, { id, origin }), [], "control");
  for (const [what, bad, why] of [
    ["no MCP", good.replace(/ {2}MCP.*\n/, ""), /no MCP line/],
    ["no badge", good.replace(/\[!\[Ludion ID\].*$/, ""), /no badge/],
    ["a frozen word", `${good}\n  Depth: D0`, /frozen word Depth/],
    ["a key", `${good}\n{"d":"secret"}`, /a secret/],
    ["another name first", good.replace("Your AI's name:", "Diver created:"), /first line/],
  ]) assert.ok(screenProblems(bad, { id, origin }).some((x) => why.test(x)), what);
});

test("DIV-5: init shows the one screen, in English and in Japanese, and for a custom domain", () => {
  const en = init(["--name", "Agent", "--contact", "mailto:ops@example.com"]);
  assert.equal(en.status, 0, en.stderr);
  const id = en.store.diver_id, origin = `https://${id}.agents.ludion.ai`;
  assert.deepEqual(screenProblems(en.stdout, { id, origin }), [], en.stdout);
  const ja = init(["--name", "Agent"], { env: { LANG: "ja_JP.UTF-8" } });
  assert.deepEqual(screenProblems(ja.stdout, { id: ja.store.diver_id, origin: `https://${ja.store.diver_id}.agents.ludion.ai`, lang: "ja" }), [], ja.stdout);
  const own = init(["--name", "Agent", "--domain", "agent.example.com"]);
  assert.deepEqual(screenProblems(own.stdout, { id: own.store.diver_id, origin: "https://agent.example.com" }), [], own.stdout);
  console.log(`DIV-5: one screen (name, Web, MCP, revoke, badge) in en, ja and for a custom domain; 0 frozen words, 0 secrets`);
});

test("DIV-6: when to ask — a terminal, not CI, not refused; or when asked to", () => {
  assert.equal(shouldAsk({ stdinTTY: true, stdoutTTY: true, env: {} }), true);
  assert.equal(shouldAsk({ stdinTTY: true, stdoutTTY: true, env: { CI: "true" } }), false, "CI");
  assert.equal(shouldAsk({ stdinTTY: false, stdoutTTY: true, env: {} }), false, "piped stdin");
  assert.equal(shouldAsk({ stdinTTY: true, stdoutTTY: false, env: {} }), false, "piped stdout");
  assert.equal(shouldAsk({ refuse: true, force: true, stdinTTY: true, stdoutTTY: true, env: {} }), false, "--no-question wins");
  assert.equal(shouldAsk({ force: true, env: { CI: "true" } }), true, "--ask");
  assert.deepEqual(["1", "2", "3", "4", " MCP ", "web", "", "5", "0", "yes", "mcp please"].map(parseAnswer), ["mcp", "web", "revocable", "other", "mcp", "web", null, null, null, null, null]);
  assert.deepEqual(ANSWERS, ["mcp", "web", "revocable", "other"]);
});

test("DIV-6: not asked, skipped, or answered with nonsense: not one network attempt", () => {
  for (const [what, args, input] of [["no terminal", [], ""], ["skipped (Enter)", ["--ask"], "\n"], ["nonsense", ["--ask"], "maybe later\n"], ["stdin closed", ["--ask"], ""]]) {
    const r = init([...args, "--name", "Agent"], { input, trap: true });
    assert.equal(r.status, 0, `${what}: ${r.stderr}`);
    assert.deepEqual(r.net, [], `${what}: ${r.net.join(", ")}`);
    assert.equal(/What will you use it for/.test(r.stdout), args.includes("--ask"), `${what}: asked only with --ask (no terminal here)`);
  }
});

test("DIV-6: an answer is one POST of one word: no Diver id, name, contact or key", async () => {
  const got = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { got.push({ method: req.method, url: req.url, headers: req.headers, body: b }); res.writeHead(204).end(); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/api/init-answer`;
    const cwd = tmp();
    const child = spawn(process.execPath, [CLI, "init", "--dev", "--ask", "--name", "Secret Name Agent", "--contact", "mailto:private@example.com"], {
      cwd, env: { ...process.env, CI: "", LANG: "en_US.UTF-8", LUDION_INIT_ANSWER_URL: url }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stdin.end("1\n");
    const code = await new Promise((r) => child.on("close", r));
    assert.equal(code, 0, out);
    const store = JSON.parse(fs.readFileSync(path.join(cwd, "ludion.json"), "utf8"));
    assert.equal(got.length, 1, "exactly one request");
    const [q] = got;
    assert.equal(q.method, "POST");
    assert.equal(q.url, "/api/init-answer");
    assert.deepEqual(JSON.parse(q.body), { answer: "mcp" });
    for (const secret of [store.diver_id, "Secret Name Agent", "private@example.com", store.session.d, store.root.d]) {
      assert.ok(!q.body.includes(secret) && !JSON.stringify(q.headers).includes(secret), `the answer carried ${secret.slice(0, 12)}…`);
    }
    assert.ok(!q.headers.cookie && !q.headers.authorization, "no cookie, no credentials");
    assert.match(out, /Thank you\. Sent: one word, nothing else\./);
  } finally { srv.close(); }
});
