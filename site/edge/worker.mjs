// The site on Workers (the preview of WEB-1, WEB-8): the build's static files, POST /api/signup,
// POST /api/init-answer (init's optional question) and GET /badge/<diver_id>.svg (init's README badge).
// Workers answers a request for a static file without running this; everything else comes here.
import { ENDPOINT, createLimiter, handleSignup } from "./signup.mjs";
import { INIT_ANSWER_ENDPOINT, handleInitAnswer } from "./init-answer.mjs";
import { badgeResponse } from "./badge.mjs";

const limiter = createLimiter();
const answers = createLimiter();

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    // Cloudflare sets CF-Connecting-IP to the client's address; a client cannot choose it.
    const client = request.headers.get("cf-connecting-ip") ?? "";
    if (pathname === ENDPOINT) return handleSignup(request, { webhook: env.SIGNUP_WEBHOOK_URL, client, limiter });
    if (pathname === INIT_ANSWER_ENDPOINT) return handleInitAnswer(request, { webhook: env.SIGNUP_WEBHOOK_URL, client, limiter: answers });
    const badge = badgeResponse(pathname);
    if (badge) return badge;
    return env.ASSETS.fetch(request);
  },
};
