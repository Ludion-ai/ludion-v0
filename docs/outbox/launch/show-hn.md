# Show HN — draft (English). The human posts it; nothing here is published by Claude.

Prerequisites before posting (spec §20.2): npm `ludion-ai` published; the Registry (`registry.ludion.ai`)
and the Card Host (`*.agents.ludion.ai`, ACM certificate) live; ludion.ai redeployed from main (with
`/census`); the demo shop live for the video; the tracecheck numbers below filled in from PILOT-2; every
`[ ]` resolved.

---

**Title**

Show HN: Ludion – Identity, limits and a kill switch for AI agents

**URL**

https://ludion.ai

**Text**

AI agents now read, compare, log in and buy for people. A site that sees one usually cannot answer
three questions about it: who is this AI, what is it allowed to do here, and how do I stop it — just
this one, without stopping the person behind it.

Ludion answers the three at the site itself:

- **Who is this AI?** One line gives an agent its own key and a public name:

      npx ludion-ai init --name "My Agent" --contact mailto:you@example.com

  It signs every request with that name (Web Bot Auth: RFC 9421 HTTP Message Signatures with a
  `Signature-Agent`), and the same name is its MCP `client_id` (an OAuth Client ID Metadata Document),
  proven with `private_key_jwt` — no client secret to leak.

- **What may it do?** Its operator puts a Mandate on it — the scopes it may use on each site:

      npx ludion-ai mandate create --site https://shop.example --scope read,checkout --checkout-max 5000 --currency JPY --per-day 3

  The Mandate is signed with the operator's Root key; the running agent only ever holds a session key.
  The site's Gate refuses anything outside the Mandate (`403 mandate_scope`). So when a planted review
  talks the agent into changing the account's password and closing the account, the shop says no — and
  it says no again when someone signs by hand with the agent's stolen session key. They cannot widen
  the Mandate either: the Registry takes only the Root's signature.

- **How is it stopped?** `npx ludion-ai revoke`. Sites that subscribe to revocations stop it within
  seconds; every other site within the hour its signed status lasts.

The Gate is free and open source, for Node, Next.js and Cloudflare Workers. It goes in with three lines
or fewer and starts by only watching: nothing changes for people. Letting a name through, putting up a
wall or stopping it is one line of the site's own config. Only the site decides; Ludion's servers have
no switch to stop anyone. What leaves a site is hourly counts, never a visit.

What we saw on tracecheck.dev over 7 days (a small site of ours with the Gate at Pressure 0):
[__] automated requests, [__]% of them named with a signature, [__] wrote while claiming a crawler's
name, [__] signed "read only" and then wrote.

It is built on the standards (IETF Web Bot Auth drafts, RFC 9421, OAuth CIMD), the spec and the code
are open (Apache-2.0), and every claim is a test in the repo (the "oracles": a scoreboard that CI holds
to a ratchet). The 60-second demo above runs in CI on every change.

What we would love to hear: if you run an agent, would you put limits like these on it? If you run a
site, what would you want to decide about the agents that come — and about those that don't name
themselves?

---

**First comment (from the founder's account, right after posting)**

Hi HN — before building this we looked at how the agents people use today answer the three questions:
whether they sign and name themselves, whether they say what they came to do, whether a site can stop
just that agent, and whether there is a public way to do it. Every value has a source and a date:
https://ludion.ai/census (corrections welcome — the page says how).

What Ludion does not prevent:

- A Mandate today is the limit an agent's operator puts on it, not the consent of the person the agent
  acts for. That consent page is not open yet.
- Only a site with a Gate holds an agent to its Mandate. On a site without one, nothing stops it there.
- Whoever steals the Root key as well can issue new Mandates. Keep the Root off the machine the agent
  runs on (OS keychain or KMS); today the CLI seals it with a passphrase.
- It does not detect prompt injection, and does not judge whether an allowed action is wise. A request
  inside the Mandate passes, even when the agent was tricked into it.

And what it deliberately does not do: it does not fingerprint browsers or guess who is a bot (unsigned
automation is counted, not judged); Ludion's servers cannot block anyone; it does not sell trust; and
per-visit records stay on the site.

Repo: https://github.com/Ludion-ai/Ludion — happy to answer anything about the protocol choices
(why RFC 9421 and not mTLS, why the Root signs Mandates, what "stopped within the hour" really means).
