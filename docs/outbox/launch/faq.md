# Thread answers — draft (English, three lines each at most). The human posts; Claude does not.

**What are the three questions, and what does Ludion not prevent?**
Who is this AI (its own key and name), what may it do (its Mandate, held by each site's Gate), how is it stopped (`npx ludion-ai revoke`). What Ludion does not prevent: a Mandate today is the operator's limit, not the consent of the person the agent acts for; only a site with a Gate holds the line, a site without one does not; whoever steals the Root key as well can issue new Mandates; and it does not detect prompt injection.

**How is this different from an allowlist?**
An allowlist decides who may come in, by a name the request merely claims (a User-Agent, an IP range).
Ludion checks a signature for who, the Mandate's scope for what — per route, so an agent let in to browse
still cannot change an account — and revocation for stop. A hijacked agent or a stolen key stays inside.

**Can it protect AI that runs inside the user's own browser?**
No. An agent that drives the user's own browser session and does not sign looks exactly like the user —
same cookies, same address — and we won't fingerprint people to guess. A site can ask for a signature
where it matters (checkout, login); an agent that signs gets a name and limits, one that doesn't is the user.

**How is this different from products that detect prompt injection?**
They read the text and try to spot the attack, which is a guess; Ludion never reads the text. It bounds
what the agent can do at the site, so an injection that succeeds still cannot step outside the Mandate.
They work together: detection makes the agent fooled less often; the Mandate limits what follows.

**How is this different from Cloudflare's signed agents / Web Bot Auth?**
Same standard — we build on it, not against it. Cloudflare verifies signatures for sites behind
Cloudflare and lists the large operators; Ludion gives any agent a key and a name in one line, limits
per site (the Mandate), and an open Gate that verifies inside the site on any host (Node, Next.js, Workers).

**Why not just mTLS?**
mTLS proves a connection, and most sites terminate TLS at a CDN or proxy, so the client certificate never
reaches the app. An RFC 9421 signature travels with the request itself, survives that, covers the method,
path, body and the Mandate, and its key is found from the name in the request.

**What stops a hijacked agent from just asking for a bigger Mandate?**
The Registry issues a Mandate only on a statement signed by the operator's Root key, and the running
agent holds only a session key. A thief with the session key gets `401` from the Registry; the demo shows it.

**CIMD isn't a standard yet.**
Right — the OAuth Client ID Metadata Document is an IETF draft, and so is Web Bot Auth; we pin the
revisions we implement and a test flags a newer one within a week. MCP's authorization spec already
recommends CIMD for client registration, and we run the flow end to end against Keycloak 26.8 with it on.

**What about privacy?**
Per-visit records stay on the site for 7 days; only hourly counts leave (route template, read or write,
class, decision, operator, and whether a Mandate allowed it) — no IPs, bodies, cookies, query values or
Mandates. The Card Host keeps no logs, and large verifiers get the whole registry.

**Who pays for this?**
Not sites and not agents, for what is here: the Gate, verification and blocking are free and stay free. Later, agents that want to be trusted with money may pay for a guarantee (that is not offered today).
Trust itself is not for sale: a test checks that no payment field can raise an agent's standing.
