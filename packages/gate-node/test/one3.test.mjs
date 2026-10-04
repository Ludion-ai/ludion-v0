// ONE-3 (±): let through, wall and stop — the three things a site decides (spec §9.3, §12.4, §12.6) —
// each take effect with one line of the site's config and are undone by deleting that line, and
// the person's path does not change (GATE-1's measure: every byte but the Gate's Ludion-* headers).
//
//   wall:          "pressure": 1                                    unnamed automation meets the site's
//                                                                    friction; signed agents pass
//   stop:          { "match": "/login", "pressure": 2 }             on that route, what cannot prove who
//                                                                    it is is refused; elsewhere nothing
//   let through:   { "who": "attacker.example", "action": "allow" } a signed agent passes a route that
//                                                                    would hold it to more
//   per visitor:   { "who": "unnamed", "action": "wall", "scope": "/login" }
//
// The real gate-node middleware reads the config text; the five visitors are those of BLK-1, each
// checked to be classified as who it is, so a line that names it is tested on it.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, baseConfig, addLine, lineDiff, startSite, visit, outcome, personBytes, friction, VISITORS, IDENTITY, SIGNER } from "./site-world.mjs";

let W, BASE;
const ROUTES = ['{ "match": "/checkout/**", "pressure": 2 }', '{ "match": "/members/**", "pressure": 2, "require": { "depth": 1 } }'];
before(async () => { W = await makeWorld(); BASE = baseConfig(W, { routes: ROUTES }); });

async function survey(text, paths) {
  const site = await startSite(W, text, { onFriction: friction });
  try {
    const out = {};
    for (const p of paths) {
      const n = site.seen.length, row = {};
      for (const who of VISITORS) row[who] = await visit(site, W, who, "GET", p);
      assert.deepEqual(Object.fromEntries(VISITORS.map((w, i) => [w, site.seen[n + i]])), IDENTITY, `${p}: the visitors are who they are`);
      out[p] = { outcomes: Object.fromEntries(VISITORS.map((w) => [w, outcome(row[w])])), person: personBytes(row.person) };
    }
    return out;
  } finally { await site.close(); }
}

/** Apply a one-line edit, check it is one line, then that deleting it restores the file and the site. */
async function oneLine(name, after, line, paths, expect) {
  const edited = addLine(BASE, after, line);
  assert.deepEqual(lineDiff(BASE, edited), { added: 1, removed: 0 }, `${name}: one line`);
  const before = await survey(BASE, paths), on = await survey(edited, paths);
  for (const p of paths) {
    assert.deepEqual(on[p].outcomes, { ...before[p].outcomes, ...expect(p) }, `${name} on ${p}`);
    assert.equal(on[p].person, before[p].person, `${name} on ${p}: the person's response does not change`);
  }
  const undone = edited.replace(`\n${line}`, "");
  assert.equal(undone, BASE, `${name}: deleting the line restores the file`);
  const after2 = await survey(undone, paths);
  for (const p of paths) assert.deepEqual(after2[p].outcomes, before[p].outcomes, `${name} on ${p}: deleting the line undoes it`);
  return { before, on };
}

test("ONE-3: wall — one line (\"pressure\": 1) puts the site's friction in front of unnamed automation and a crawler's name, lets signed agents through, and deleting it undoes it", async () => {
  const { before } = await oneLine("wall", /"site_id"/, '  "pressure": 1,', ["/", "/products/1"], () => ({ crawler: "wall", unnamed: "wall" }));
  assert.deepEqual(before["/"].outcomes, { person: "ok", diver: "ok", signer: "ok", crawler: "ok", unnamed: "ok" }, "let through is the default");
});

test("ONE-3: stop — one line (a route at Pressure 2) refuses, on that route only, what cannot prove who it is; deleting it undoes it", async () => {
  await oneLine("stop", /"routes": \[/, '    { "match": "/login", "pressure": 2 },', ["/login", "/products/1"],
    (p) => (p === "/login" ? { crawler: "signature_required", unnamed: "signature_required" } : {}));
});

test("ONE-3: let through — one line lets a signed agent through a route that would hold it to more; deleting it undoes it", async () => {
  const base = await survey(BASE, ["/members/1"]);
  assert.equal(base["/members/1"].outcomes.signer, "depth_insufficient", "the route holds a signer without a Staple to depth 1");
  await oneLine("let through", /"decisions": \[/, `    { "who": "${SIGNER}", "action": "allow" }`, ["/members/1", "/products/1"],
    (p) => (p === "/members/1" ? { signer: "ok" } : {}));
});

test("ONE-3: per visitor — one line walls unnamed automation on one route only", async () => {
  await oneLine("wall for unnamed on /login", /"decisions": \[/, '    { "who": "unnamed", "action": "wall", "scope": "/login" }', ["/login", "/products/1"],
    (p) => (p === "/login" ? { unnamed: "wall" } : {}));
  console.log("ONE-3: wall, stop and let through each took one line and were undone by deleting it; the person's response never changed (GATE-1's measure)");
});

test("ONE-3: the judge sees a line that does more than it says (planted)", async () => {
  // A config edit of two lines is not one line; an edit that leaves a trace is not undone.
  assert.deepEqual(lineDiff(BASE, addLine(addLine(BASE, /"site_id"/, '  "pressure": 1,'), /"routes": \[/, '    { "match": "/x", "pressure": 2 },')), { added: 2, removed: 0 });
  assert.deepEqual(lineDiff(BASE, BASE.replace('"pressure": 2 }', '"pressure": 3 }')), { added: 1, removed: 1 }, "a changed line counts as both");
  // A wall that also touched the person, or a stop that spilled onto another route, fails oneLine.
  await assert.rejects(oneLine("spill", /"routes": \[/, '    { "match": "/**", "pressure": 2 },', ["/login", "/products/1"],
    (p) => (p === "/login" ? { crawler: "signature_required", unnamed: "signature_required" } : {})), /products\/1/);
});
