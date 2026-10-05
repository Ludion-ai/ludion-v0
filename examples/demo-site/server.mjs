// The demo site of the launch video (docs/outbox/launch/demo-script.md): the quickstart's site, plus
// one route an AI may use only with its user's Mandate — POST /account/delete (scope "delete";
// docs/outbox/adr-2026-10-05-mandate-first-use-is-delete.md). PRS-5 runs this file's site and its
// ludion.config.json end to end.
//
//   cd examples/demo-site && npm install && PORT=3000 node server.mjs
//
// Nothing is stored and nothing is deleted: the answer says what the site would do and for whom.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ludion demo shop</title></head><body><h1>Ludion demo shop</h1><p>An AI may close an account here only with its user\'s Mandate (scope: delete). People sign in as usual.</p></body></html>';

/**
 * The site behind the Gate. For an AI, the Gate has already held POST /account/delete to a Mandate
 * with scope "delete" for this site (ludion.config.json): the account is the one the Mandate names (a
 * pseudonym only this site sees). A person reaches the same route as on any site, through the site's
 * own sign-in, which this demo does not have.
 */
export function demoSite(req, res) {
  const url = new URL(req.url, "http://demo.invalid");
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(req.method === "HEAD" ? undefined : PAGE);
  }
  if (req.method === "POST" && url.pathname === "/account/delete") {
    const cls = req.ludion?.cls;
    const m = cls?.mandate ?? null;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      deleted: true,
      account: m?.prn ?? null, // whose account: the user's pseudonym for this site, from the Mandate
      by: m ? (cls.diverId ?? null) : null, // which agent did it for them
      note: "a demo: nothing is stored and nothing is deleted",
    }));
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found\n");
}

/** ludion.config.json, with the Registry's public keys pinned (fetched once at start when the file has none). */
export async function demoConfig({ fetch = globalThis.fetch } = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(HERE, "ludion.config.json"), "utf8"));
  if (!config.registry?.keys) {
    const r = await fetch(`${config.registry.issuer}/.well-known/ludion-keys`);
    if (!r.ok) throw new Error(`cannot read the Registry's keys: ${r.status}`);
    config.registry = { ...config.registry, keys: (await r.json()).keys };
  }
  return config;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ludion } = await import("ludion-ai/gate/node");
  const gate = await ludion({ config: await demoConfig() });
  const port = Number(process.env.PORT ?? 3000);
  http.createServer((req, res) => gate(req, res, () => demoSite(req, res))).listen(port, () => console.log(`demo site on :${port}`));
}
