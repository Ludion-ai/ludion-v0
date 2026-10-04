# Show HN — draft (English). The human posts it; nothing here is published by Claude.

Prerequisites before posting (spec §20.2): npm `ludion` published; the Registry (`registry.ludion.ai`)
and the Card Host (`*.agents.ludion.ai`, ACM certificate) live; ludion.ai redeployed from main (today it
serves an older build without `/quickstart` and `/agent`); the tracecheck numbers below filled in from
PILOT-2; every `[ ]` resolved.

---

**Title**

Show HN: Ludion – Give your AI agent its own key, revocable everywhere in one line

**URL**

https://ludion.ai

**Text**

AI agents now read, compare, log in and buy for people. Most of them do it with borrowed credentials —
the user's session, a shared API key, a browser that looks exactly like the user — so a site cannot tell
whose agent is whose, and the agent's owner cannot take its access back without changing everyone's.

Ludion gives an agent an account of its own: a key and a name. One line:

    npx ludion init --name "My Agent" --contact mailto:you@example.com

You get a name, `https://dvr-….agents.ludion.ai`, and the same name works in two places:

- On the web, the agent signs its requests (Web Bot Auth: RFC 9421 HTTP Message Signatures with a
  `Signature-Agent`). Any site can check the signature against the keys published at that name.
- With MCP servers, `…/client` is the agent's OAuth `client_id` (a Client ID Metadata Document), and
  the agent authenticates with `private_key_jwt` signed by the same key — no client secret to leak.
  MCP's authorization spec recommends CIMD; we test this end to end against Keycloak 26.8 with it on.

`npx ludion revoke` ends the name everywhere: sites that subscribe to revocations hear within seconds,
every other site within the hour (the agent's signed status lasts at most one hour), and the client
document disappears for authorization servers.

For sites there is a free, open-source checkpoint (the Gate) for Node, Next.js and Cloudflare Workers.
It goes in with three lines or fewer and starts by only watching: nothing changes for people. It tells
you which agents came and what they touched, and lets you let a name through, put up a wall or stop
it — one line of your own config each. Only the site decides; Ludion's servers have no switch to stop
anyone. What leaves your site is hourly counts, never a visit.

What we saw on tracecheck.dev over 7 days (a small site of ours with the Gate at Pressure 0):
[__] automated requests, [__]% of them named with a signature, [__] wrote while claiming a crawler's
name, [__] signed "read only" and then wrote.

It is built on the standards (IETF Web Bot Auth drafts, RFC 9421, OAuth CIMD), the spec and the code
are open (Apache-2.0), and every claim on the site is a test in the repo (the "oracles": a scoreboard
that CI holds to a ratchet).

What we would love to hear: if you run an agent, would you give it a name like this? If you run a site,
what would you want to decide about agents that name themselves — and about those that don't?

---

**First comment (from the founder's account, right after posting)**

Hi HN — I built Ludion because every conversation about "AI agents on the web" ended at the same
place: the site sees a browser or an API key, and neither the site nor the agent's owner can say whose
agent it is or switch just that one off.

A few things it deliberately does not do:

- It does not detect bots. Unsigned automation is counted, not judged; we don't fingerprint browsers.
- Ludion's servers cannot block anyone. Blocking lives in each site's config.
- It does not sell trust. Verifying, the Gate and blocking are free; a test checks that nothing a
  record could be paid for raises an agent's standing.
- No people's data: per-visit records stay on the site for 7 days; the Card Host that serves names
  keeps no logs; large verifiers get the whole registry, so a lookup reveals nothing.

What is not done: guarantees (an agent backed by a deposit or insurance), delegation from a person to
an agent with limits, and Gates for Python and WordPress — they are on the roadmap, not in this
launch.

Repo: https://github.com/Ludion-ai/Ludion — happy to answer anything about the protocol choices
(why RFC 9421 and not mTLS, why CIMD, what "revoked everywhere within the hour" really means).
