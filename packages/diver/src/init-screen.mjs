// What `npx ludion-ai init` shows (spec §9.2, §13.1, DIV-5): one screen — the AI's name, the same name
// on the web (Signature-Agent) and on MCP (client_id), the one line that erases it, and a README
// badge. None of Depth, Ballast, Mandate, Pressure or Staple is on it. Then one optional question
// (DIV-6): asked only at a terminal, never in CI; skipping it sends nothing; an answer sends one
// word and nothing else.

export const ANSWERS = ["mcp", "web", "revocable", "other"];
export const ANSWER_URL = "https://ludion.ai/api/init-answer";
export const FROZEN_WORDS = ["Depth", "Ballast", "Mandate", "Pressure", "Staple"];

/** "ja" when the terminal's locale is Japanese, else "en". */
export function screenLang(env = process.env) {
  return /^ja/i.test(env.LC_ALL || env.LC_MESSAGES || env.LANG || "") ? "ja" : "en";
}

const T = {
  en: {
    name: "Your AI's name: ",
    erase: "Erase",
    eraseNote: "(within 1 hour, it stops working everywhere)",
    badge: "README badge:",
    ask: "One optional question (press Enter to skip; skipping sends nothing):",
    question: "What will you use it for?  1) MCP  2) Web  3) Because I can erase it  4) Other  > ",
    thanks: "Thank you. Sent: one word, nothing else.",
  },
  ja: {
    name: "あなたの AI の名前：",
    erase: "消す ",
    eraseNote: "（1時間以内に、世界中で通らなくなります）",
    badge: "README に貼るバッジ：",
    ask: "任意の質問が1つあります（Enter で飛ばせます。飛ばせば何も送りません）：",
    question: "何に使いますか？  1) MCP  2) Web  3) 消せるから  4) その他  > ",
    thanks: "ありがとうございます。送ったのは一語だけです。",
  },
};

/** The one screen, as lines. `origin` is the identity's https origin (its Signature-Agent). */
export function initScreen({ diverId, origin, lang = "en" }) {
  const t = T[lang] ?? T.en;
  return [
    `${t.name}${origin}`,
    "",
    `  Web    Signature-Agent: sig1="${origin}"`,
    `  MCP    client_id = ${origin}/client`,
    `  ${t.erase}  npx ludion-ai revoke   ${t.eraseNote}`,
    "",
    `  ${t.badge}`,
    `  [![Ludion ID](https://ludion.ai/badge/${diverId}.svg)](${origin})`,
  ];
}

/** Whether to ask: at a terminal (stdin and stdout), not in CI, not refused; or when asked to (--ask). */
export function shouldAsk({ force = false, refuse = false, stdinTTY, stdoutTTY, env = process.env }) {
  if (refuse) return false;
  if (force) return true;
  return !!stdinTTY && !!stdoutTTY && !env.CI;
}

/** "1".."4" or a word → one of ANSWERS; anything else (an empty line included) → null: nothing is sent. */
export function parseAnswer(line) {
  const s = String(line ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^[1-4]$/.test(s)) return ANSWERS[Number(s) - 1];
  return ANSWERS.includes(s) ? s : null;
}

/**
 * Ask the question and, only for an answer, send that one word. Never throws, never waits more
 * than `timeoutMs` for the network, and sends no identity: no Diver id, name, contact or key.
 * @param {{ lang?: string, input: NodeJS.ReadableStream, output: NodeJS.WritableStream, url?: string, fetch?: typeof fetch, timeoutMs?: number }} o
 * @returns {Promise<string|null>} the answer sent, or null
 */
export async function askWhy({ lang = "en", input, output, url = ANSWER_URL, fetch: send = globalThis.fetch, timeoutMs = 3000 }) {
  const t = T[lang] ?? T.en;
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input, output, terminal: false });
  output.write(`\n${t.ask}\n${t.question}`);
  const line = await new Promise((resolve) => {
    let done = false;
    rl.once("line", (l) => { done = true; resolve(l); });
    rl.once("close", () => { if (!done) resolve(""); });
  });
  rl.close();
  const answer = parseAnswer(line);
  output.write("\n");
  if (!answer) return null;
  try {
    await send(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer }), signal: AbortSignal.timeout(timeoutMs) });
    output.write(`${t.thanks}\n`);
  } catch { /* an answer that cannot be sent is simply not sent */ }
  return answer;
}
