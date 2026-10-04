# Ludion

[日本語](README.ja.md)

**Give your AI agent its own key and name. One line to create it, the same name on MCP and on the web, one line to erase it everywhere.**

Agents now read, compare, log in and buy on people's behalf, and the sites they reach cannot tell whose agent is whose. Ludion gives an agent a name and keys, and gives sites a free, open-source checkpoint (the Gate) that reads that name. It is built on the standards: [Web Bot Auth](https://datatracker.ietf.org/wg/webbotauth/about/) ([RFC 9421](https://www.rfc-editor.org/rfc/rfc9421) signatures) for the web, and the OAuth Client ID Metadata Document (CIMD) for MCP.

## For an agent: a name and keys, in one line

```sh
npx ludion init --name "My Agent" --contact mailto:ops@example.com
```

You get one screen:

```text
Your AI's name: https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai

  Web    Signature-Agent: sig1="https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai"
  MCP    client_id = https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai/client
  Erase  npx ludion revoke   (within 1 hour, it stops working everywhere)

  README badge:
  [![Ludion ID](https://ludion.ai/badge/dvr-k7q2m6x4pcab3cde.svg)](https://dvr-k7q2m6x4pcab3cde.agents.ludion.ai)
```

- **Web**: sign your requests. `npx ludion sign GET https://example.com/` prints the signature headers for any HTTP client; in Node, `ludionFetch` from `ludion/diver` handles signing, key rotation, nonces and body digests.
- **MCP**: use `…/client` as your client_id. It is plain OAuth client metadata (CIMD) over the same keys: loopback `redirect_uris` (`http://127.0.0.1/callback`), and the agent authenticates with `private_key_jwt` signed by its session key (`clientAssertion` in `ludion/diver`) — no shared secret. Checked end to end against Keycloak 26.8.0 with CIMD on (MCP-1).
- **Erase**: `npx ludion revoke` publishes a revocation at the Registry. Gates subscribed to it hear within seconds; every other Gate within the lifetime of the agent's status (its Staple, at most one hour).
- **Purpose**: a request can say what it came to do, in one word (`read` or `act`) and one sentence (`Ludion-Purpose`, covered by the signature). A sentence with an email address, a phone number, a URL or a long number is refused before anything is sent.

## For a site: a checkpoint that reads the name

```sh
npm install ludion
```

On Express, two lines:

```js
import { ludion } from "ludion/gate/node";
app.use(await ludion());
```

and a `ludion.config.json` next to `package.json`:

```json
{ "site_id": "site-your-shop", "pressure": 0 }
```

- **It starts by watching** (Pressure 0). The pages people get do not change (the Gate adds only its own `Ludion-*` headers). When it records its first automated visit, it says so in one line on your server's console.
- **Let through, wall, stop** — each one line of the config, undone by deleting it:

  ```json
  "pressure": 1,
  ```

  puts your site's existing friction (a CAPTCHA, a slow-down) in front of automation that names no one; signed agents pass.

  ```json
  { "match": "/login", "pressure": 2 }
  ```

  refuses, on that route only, automation that cannot prove who it is (`401 signature_required`).

  ```json
  "decisions": [
    { "who": "GPTBot", "action": "block", "scope": "writes" }
  ]
  ```

  stops one name (`403 blocked_by_site`). `who` is a Diver id, a signer's host, a name in a User-Agent, or `"unnamed"`; `until` (a date and time) lifts it by itself.
- **Only the site decides.** Ludion's servers have no path to stop anyone: decisions live in the site's config and nowhere else.
- **The morning report** (`npx ludion report`) has one headline number — the share of automation that named itself with a signature — and one thing to decide. Writes under a crawler's name are shown as suspected fakes; an agent that signed "read only" and then wrote is shown beside its own words.
- Next.js (one line in `proxy.js`) and Cloudflare Workers: [ludion.ai/gate](https://ludion.ai/gate). Every refusal links to a page that explains it: [ludion.ai/e](https://ludion.ai/e).
- Planned, after the launch: the Gate for FastAPI and WordPress, and the agent side in Python.

## What leaves the site

- Only hourly counts. Their keys are the route template (`/orders/:id`), the method kind, the class, the decision and the operator (a Diver id or a claimed name); the value is a count. No visit's time, IP, country, body, cookie, query value or purpose sentence ever leaves.
- Each visit's record stays on the site for 7 days, then goes.
- With `send_metadata` off, nothing but key discovery leaves at all.

## Start from your logs

Drop an access log on [ludion.ai/scan](https://ludion.ai/scan): it counts how much unsigned automation touched your checkout, login, sign-up and forms. The log is read in your browser and sent nowhere. nginx, Apache, Caddy, IIS, CloudFront, AWS ALB, Cloudflare Logpush, Vercel and Fastly formats are recognised (gzip too). `npx ludion scan access.log` gives the same numbers locally.

## Where things stand (2026-10-04)

- **Not on npm yet.** Until it is, everything runs from this repository (`npm ci`, then the commands below).
- **The hosted Registry and the name host (`*.agents.ludion.ai`) are not live yet.** Their configuration and the deploy steps are ready ([docs/DEPLOY.md](docs/DEPLOY.md) §6). Until then, `register` and `revoke` point at the reference Registry you run yourself ([`services/registry`](services/registry)).
- Assurance (Ballast), the consent screen for delegations (Mandate) and the Depth levels exist in the code but are not offered now.

## How it is built

Ludion is built against verifiers. Progress is a row on the scoreboard turning to PASS, not someone saying it works.

- [`docs/MISSION.md`](docs/MISSION.md) lists the oracles: what must be true, each paired with a negative of the same property (the real thing passes, a fake does not).
- [`accept/registry.mjs`](accept/registry.mjs) runs them, and `npm run scoreboard` prints the board.
- A ratchet (`npm run ratchet`) pins every oracle that has passed; CI refuses a change that breaks one.
- The product's intent is [`docs/ludion-spec.md`](docs/ludion-spec.md) (Japanese); its §8 lists the invariants. Decisions are recorded in [`docs/adr/`](docs/adr).

```sh
npm ci
npm test               # seconds
npm run scoreboard     # minutes: every oracle
node examples/e2e.mjs  # an agent, a Gate, VERIFIED, all on 127.0.0.1
```

## Repository

| Path | What |
|---|---|
| `packages/ludion` | The one package on npm: the CLI, `ludion/diver`, `ludion/gate/{node,next,workers}` |
| `packages/gate-core` | The Gate: verification, classification, decisions, receipts, purpose. Runtime-neutral |
| `packages/gate-node`, `gate-next`, `gate-workers` | The Gate for Node servers, Next.js (`proxy.js`) and Cloudflare Workers |
| `packages/diver` | The agent side: keys, the card and client document, signing, the CLI |
| `packages/scan`, `packages/report` | The log scan (CLI and browser) and the morning report |
| `packages/card-host` | Serves an agent's key directory, card and client document |
| `services/registry` | The Registry: registration, status, revocation, the whole copy for large verifiers |
| `python` | The agent side in Python (planned: not published, not part of the launch) |
| `site` | ludion.ai (Astro + Starlight), English and Japanese |
| `accept`, `reference`, `clean-room`, `interop` | The oracles, attack corpus, conformance vectors, reference apps and fixtures |

## Principles

- **Neutral.** No dependency on any particular CDN, AI lab, cloud or payment network. The Gate runs in the site's own infrastructure.
- **Open.** The spec, the Gate and the SDKs are open source. Only the operation (the Registry) is Ludion's.
- **No people's data.** Only counts leave a site.
- **No home-made cryptography.** Ed25519 through WebCrypto, RFC 9421 through the Web Bot Auth reference implementation.

## License and security

Apache-2.0 ([LICENSE](LICENSE)). Report vulnerabilities as described in [SECURITY.md](SECURITY.md).
