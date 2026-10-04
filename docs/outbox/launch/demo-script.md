# 60-second demo — script (record once production is up; the human records)

Prerequisites: npm `ludion` published; Registry and Card Host live (`*.agents.ludion.ai` certificate
Active, DEPLOY.md §4); a demo site with the Gate (the quickstart's Express app, on a public URL); an
MCP authorization server with CIMD on (Keycloak 26.8, as MCP-1 runs it) behind a public URL.
One terminal on the left, the demo site's console on the right. Large font, no notifications.

| Time | On screen | Voice-over (one line) |
|---|---|---|
| 0:00–0:06 | Title card: "Give your AI agent its own key." | "Your AI agent has no account of its own. Let's give it one." |
| 0:06–0:18 | `npx ludion init --name "Demo Agent" --contact mailto:demo@ludion.ai` → the one screen: *Your AI's name: https://dvr-….agents.ludion.ai*, the Web line, the MCP line, the Erase line | "One line: a key, sealed with a passphrase, and a name." |
| 0:18–0:24 | `curl -s https://dvr-….agents.ludion.ai/card` — the card, `token_endpoint_auth_method: "private_key_jwt"` | "The name is public. The key never leaves the agent." |
| 0:24–0:34 | Web: `node agent.mjs` (the `/agent` page's code) → `200 VERIFIED`. Right pane: the Gate's console line *recorded the first automated visit — VERIFIED dvr-…* | "On the web, it signs. The site checks the signature against the name." |
| 0:34–0:45 | MCP: the agent opens the authorization URL with `client_id=https://dvr-….agents.ludion.ai/client`, the person consents, and the token comes back for that client_id | "With MCP, the same name is its client_id. No client secret anywhere." |
| 0:45–0:55 | `npx ludion revoke` → run `node agent.mjs` again: the receipt says `REVOKED`; `curl` on `…/client` → 404; the MCP authorization now fails | "One line ends it — on the web, and for MCP." |
| 0:55–1:00 | End card: ludion.ai · github.com/Ludion-ai/Ludion · "Sites: free Gate, Node / Next.js / Workers" | "Open source. Sites decide." |

Notes for the take:

- Use a fresh directory and a fresh name (the screen shows the real id; blur nothing — nothing on it is secret).
- Keep the passphrase prompt off screen (set `LUDION_ROOT_PASSPHRASE` before recording).
- The revoke step needs the demo site's Gate subscribed to the Registry's revocations, so the change
  shows in seconds; without the subscription it takes up to an hour (the Staple's lifetime).
- Rehearse the MCP step: Keycloak shows a consent page for a CIMD client the first time.
