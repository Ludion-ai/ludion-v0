// A version's own preview URL (https://<version>-ludion-site-preview.<subdomain>.workers.dev) serves that
// build and only it, so WEB-1 can measure it while another run deploys. Cloudflare adds one header to
// version URLs that the live preview does not send: `X-Robots-Tag: noindex` (2026-10-04). Lighthouse's
// SEO category reads it (is-crawlable) and the site never sent it. The relay passes the version's
// responses through byte for byte — status, headers, compressed bodies — and removes that one header,
// only where the live URL is shown not to send it. Nothing else is changed.
import http from "node:http";
import https from "node:https";

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "upgrade"]);

/** Does the live preview send X-Robots-Tag? (It must not, for the relay to remove it from a version.) */
export async function liveRobotsTag(liveUrl) {
  const r = await fetch(`${liveUrl}/`, { method: "HEAD", cache: "no-store" });
  return r.headers.get("x-robots-tag");
}

/**
 * Start a relay on 127.0.0.1 for `target` (a version URL).
 * @returns {Promise<{ url: string, close: () => Promise<void>, removed: () => number }>}
 */
export async function previewRelay(target) {
  const base = new URL(target);
  let removed = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, base);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP.has(k)));
    headers.host = base.host;
    const up = (base.protocol === "http:" ? http : https).request(u, { method: req.method, headers }, (r) => {
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) {
        if (HOP.has(k)) continue;
        if (k === "x-robots-tag" && String(v).trim().toLowerCase() === "noindex") { removed++; continue; }
        out[k] = v;
      }
      res.writeHead(r.statusCode ?? 502, out);
      r.pipe(res);
    });
    up.on("error", (e) => { res.writeHead(502).end(String(e?.message ?? e)); });
    req.pipe(up);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    removed: () => removed,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}
