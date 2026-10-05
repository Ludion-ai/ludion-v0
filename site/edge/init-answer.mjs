// POST /api/init-answer: the one optional question `npx ludion-ai init` asks (spec §13.1, DIV-6).
// The body is one word and nothing else: {"answer": "mcp" | "web" | "revocable" | "other"}. Anything
// more (a name, an id, any other field) is refused, so no identity can arrive here by mistake. The
// word goes to the founder's notifier (SIGNUP_WEBHOOK_URL) as one line; nothing is logged or kept.
// Limited like the signup form (per client, and in all; in memory, per instance).

export const INIT_ANSWER_ENDPOINT = "/api/init-answer";
export const ANSWERS = ["mcp", "web", "revocable", "other"];
const MAX_BODY = 256;
const NOTIFY_TIMEOUT_MS = 5000;

const reply = (status, headers = {}) => new Response(null, { status, headers: { "cache-control": "no-store", ...headers } });

/**
 * @param {Request} request
 * @param {{ webhook?: string, client?: string, limiter: { take(client: string): number }, fetch?: typeof fetch }} opts
 */
export async function handleInitAnswer(request, { webhook, client = "", limiter, fetch: send = fetch }) {
  if (request.method !== "POST") return reply(405, { allow: "POST" });
  const retry = limiter.take(client);
  if (retry) return reply(429, { "retry-after": String(retry) });
  if ((request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return reply(415);
  const text = await request.text();
  if (text.length > MAX_BODY) return reply(413);
  let body;
  try { body = JSON.parse(text); } catch { return reply(400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "answer" || !ANSWERS.includes(body.answer)) return reply(400);
  if (!webhook) return reply(503);
  const line = `ludion init: ${body.answer}`;
  try {
    const r = await send(webhook, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: line, content: line, allowed_mentions: { parse: [] }, flags: 4 }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
    if (!r.ok) return reply(502);
  } catch { return reply(502); }
  return reply(204);
}
