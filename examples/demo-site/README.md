# Demo site

The site in the launch video (`docs/outbox/launch/demo-script.md`). It is the quickstart's site plus one
route an AI may use only with its user's Mandate:

- `POST /account/delete` — Pressure 2, `require: { "scope": "delete" }`. An AI without a Mandate for
  this site with scope `delete` gets `403 mandate_required` (or `mandate_scope` with another scope).
  With one, the site answers for the account the Mandate names: a pseudonym only this site sees.
  Nothing is stored or deleted.
- People are untouched: they reach the site as on any site, through its own sign-in.

To run it for the video, on the demo's own host (the human does this):

1. Set `authorities` in `ludion.config.json` to the host it runs on.
2. `npm install` (needs `ludion-ai` on npm), then `PORT=3000 npm start`. At start it pins the Registry's
   public keys from `https://registry.ludion.ai/.well-known/ludion-keys` (a real site pins them in its
   file) and subscribes to the revocation stream, so a `npx ludion-ai revoke` shows within seconds.

The consent page that issues Mandates is frozen (spec §9.5); for now a Mandate comes from a test
issuance. PRS-5 runs this site and its config end to end.
