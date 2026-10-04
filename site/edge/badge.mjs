// GET /badge/<diver_id>.svg: the README badge `npx ludion init` prints (spec §13.1). It shows the
// Diver id it is asked for and nothing else: no lookup, no state, so it says nothing about the agent
// that the README's own link (the agent's name) does not. Anything but a Diver id is 404.

export const BADGE_PREFIX = "/badge/";
const ID = /^dvr-[a-z2-7]{16}$/;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** The badge for a path, or null when the path is not a badge's. */
export function badgeResponse(pathname) {
  if (!pathname.startsWith(BADGE_PREFIX) || !pathname.endsWith(".svg")) return null;
  const id = pathname.slice(BADGE_PREFIX.length, -".svg".length);
  if (!ID.test(id)) return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const left = "Ludion ID", lw = 70, rw = 8 + id.length * 7, w = lw + rw;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${left}: ${esc(id)}">
<title>${left}: ${esc(id)}</title>
<rect width="${lw}" height="20" fill="#1b1f24"/><rect x="${lw}" width="${rw}" height="20" fill="#0f766e"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="8" y="14">${left}</text><text x="${lw + 6}" y="14">${esc(id)}</text></g>
</svg>
`;
  return new Response(svg, { status: 200, headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}
