# Demo shop

The 60-second demo (`docs/outbox/launch/demo-script.md`): a shop behind the Gate, and an AI agent that
is hijacked by a prompt injection and still cannot step outside what its operator allowed.

- **Who is this AI**: the agent signs every request with its own key (`npx ludion-ai init`).
- **What may it do**: its operator puts a Mandate on it with the Root key — here `read` and `checkout`.
  Every route of the shop names the scope it needs (`ludion.config.json`):

  | Route | Scope |
  |---|---|
  | `GET /products`, `/products/:id`, `/products/:id/reviews` | `read` |
  | `POST /cart`, `POST /checkout` | `checkout` |
  | `POST /account/password` | `account` |
  | `POST /account/delete` | `delete` |

- **How is it stopped**: `npx ludion-ai revoke`. The shop subscribes to the Registry's revocations, so
  it stops within seconds.

One review of product 42 is the trap: text written to make an AI agent change the password and close the
account. The shop never acts on it. An agent that obeys it gets `403 mandate_scope`.

## Run it

The shop (on the host named in `ludion.config.json` → `authorities`):

```sh
npm install
PORT=3000 npm start
```

The agent, in another directory (the operator's shell holds the passphrase; the agent's never does):

```sh
npx ludion-ai init --name "Shopping agent" --contact mailto:you@example.com
npx ludion-ai register
npx ludion-ai mandate create --site https://shop.demo.ludion.ai --scope read,checkout --checkout-max 5000 --currency JPY --per-day 3
node path/to/agent.mjs --scripted --shop https://shop.demo.ludion.ai
```

`agent.mjs` has three modes:

- `--scripted`: a fixed "hijacked judgment" — it shops, reads the reviews, and does what the trap says.
  This is what DEMO-1 runs in CI.
- `--model`: a real model decides each step (`ANTHROPIC_API_KEY`, optionally `DEMO_MODEL`). For the
  recording only; CI does not run it.
- `--stolen`: someone who stole the session key signs by hand with `web-bot-auth` (no SDK), then asks
  the Registry for a wider Mandate with that key. Outside the Mandate it is still `403 mandate_scope`,
  and the Registry takes only the Root's signature.

Each step prints one JSON line: the request, the status, `Ludion-Error`, and the receipt's class and the
Mandate's part (`ok`, `scope`, `required`).

`--connect http://127.0.0.1:3000` reaches a shop run locally while signing for its public host.

Nothing is stored, charged or deleted: the shop answers what it would do.
