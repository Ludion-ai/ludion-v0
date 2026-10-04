# Thread answers — draft (English, three lines each at most). The human posts; Claude does not.

**How is this different from Cloudflare's signed agents / Web Bot Auth?**
Same standard — we build on it, not against it. Cloudflare verifies signatures for sites behind
Cloudflare and lists the large operators; Ludion gives any agent a key and a name in one line, the same
name for MCP, and an open Gate that verifies inside the site on any host (Node, Next.js, Workers).

**Why not just mTLS?**
mTLS proves a connection, and most sites terminate TLS at a CDN or proxy, so the client certificate never
reaches the app. An RFC 9421 signature travels with the request itself, survives that, covers the method,
path and body, and its key is found from the name in the request.

**CIMD isn't a standard yet.**
Right — the OAuth Client ID Metadata Document is an IETF draft, and so is Web Bot Auth; we pin the
revisions we implement and a test flags a newer one within a week. MCP's authorization spec already
recommends CIMD for client registration, and we run the flow end to end against Keycloak 26.8 with it on.

**What about privacy?**
Per-visit records stay on the site for 7 days; only hourly counts leave (route template, read or write,
class, decision, operator) — no IPs, bodies, cookies or query values. The Card Host keeps no logs, and
large verifiers get the whole registry, so asking about one agent reveals nothing.

**Who pays for this?**
Not sites and not agents, for what is here: the Gate, verification and blocking are free and stay free.
Later, agents that want to be trusted with money may pay for a guarantee (that is not offered today).
Trust itself is not for sale: a test checks that no payment field can raise an agent's standing.

**What about AI that runs inside the user's own browser?**
If it doesn't sign, a Gate sees its user — and we won't fingerprint people to guess. A site can ask for
a signature only where it matters (checkout, login), and an agent that wants through signs: the keys
and the one-line setup are the same wherever the agent runs.
