// GATE-13 (−, install-effort): GATE-3's measures cannot be passed by a bigger install or by a Gate that
// does not deliver. The same functions GATE-3 runs (reference/gate3-measure.mjs) are tried on planted
// installs — copies of reference/express with one thing wrong — and on planted first records; each is
// caught for its own reason. The real install passes the same functions, and GATE-3's limits are the
// ones the spec states (a loosened limit fails here).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REF, ROOT } from "../harness.mjs";
import { installDiff, installProblems, recordProblems, LIMIT_S, MAX_CODE_LINES, MAX_CONFIG_FILES, README } from "../gate3-measure.mjs";

const readme = fs.readFileSync(path.join(ROOT, "packages", README.express, "README.md"), "utf8");

/** A copy of reference/express whose install is changed by `plant(dir)`. */
function planted(plant) {
  const ref = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-gate13-"));
  for (const part of ["site", "install"]) fs.cpSync(path.join(REF, "express", part), path.join(ref, "express", part), { recursive: true, filter: (p) => !/node_modules/.test(p) });
  plant(path.join(ref, "express", "install"), path.join(ref, "express", "site"));
  return ref;
}
const server = (dir) => path.join(dir, "server.mjs");
const edit = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, "utf8")));

const INSTALLS = [
  ["every Gate line twice", (i) => edit(server(i), (s) => s.replace(/^(import \{ ludion \}.*\n)/m, "$1$1").replace(/^(app\.use\(await ludion\(\)\);\n)/m, "$1$1")), /application lines changed/],
  ["edits beside the install", (i) => edit(server(i), (s) => s.replace("Reference Shop", "Reference Shop (gated)").replace("No such product", "Not here").replace("Missing credentials", "Missing")), /application lines changed/],
  ["a second config file", (i) => fs.writeFileSync(path.join(i, "wrangler.json"), "{}\n"), /config files/],
  ["a hand-edited package.json", (i, site) => fs.writeFileSync(path.join(i, "package.json"), fs.readFileSync(path.join(site, "package.json"), "utf8").replace('"dependencies": {', '"dependencies": {\n    "ludion": "0.0.1",')), /dependencies come from npm install/],
  ["a line the README does not show", (i) => edit(server(i), (s) => s.replace("app.use(await ludion());", "app.use(await ludion({ trustProxy: true }));")), /does not show the installed line/],
  ["nothing changed", (i, site) => { for (const f of fs.readdirSync(i)) fs.rmSync(path.join(i, f)); fs.copyFileSync(path.join(site, "server.mjs"), path.join(i, "server.mjs")); }, /changes nothing/],
  ["empty", (i) => { for (const f of fs.readdirSync(i)) fs.rmSync(path.join(i, f)); }, /changes nothing/],
];

test("GATE-13: GATE-3's install measure catches every planted install, each for its own reason", () => {
  const missed = [];
  for (const [name, plant, why] of INSTALLS) {
    const ref = planted(plant);
    try {
      const p = installProblems("express", installDiff("express", { ref }), readme);
      if (!p.some((x) => why.test(x))) missed.push(`${name}: ${p.join("; ") || "passed"}`);
    } finally { fs.rmSync(ref, { recursive: true, force: true }); }
  }
  assert.deepEqual(missed, []);
  assert.deepEqual(installProblems("express", installDiff("express"), readme), [], "control: the real install passes the same measure");
});

test("GATE-13: GATE-3's record measure catches a Gate that does not deliver", () => {
  const site = "site-reference-express", t0 = 1000;
  const good = { at: t0 + 2000, event: { site, class: "SUSPECTED", route: "/products/:id" } };
  assert.deepEqual(recordProblems("express", good, { t0, site }), [], "control");
  const planted = [
    ["no record", null, {}, /no classified record/],
    ["too late", { ...good, at: t0 + (LIMIT_S + 1) * 1000 }, {}, /after 61\.0s/],
    ["another site", { ...good, event: { ...good.event, site: "site-other" } }, {}, /not site-reference-express/],
    ["curl taken for a person", { ...good, event: { ...good.event, class: "UNKNOWN" } }, {}, /not SUSPECTED/],
    ["the raw path", { ...good, event: { ...good.event, route: "/products/2" } }, {}, /not the template/],
    ["a visit sent out", good, { sinkEvents: [{ event: { v: 0, rid: "rcp-x", class: "SUSPECTED", route: "/products/:id" } }] }, /got a visit/],
  ];
  const missed = planted.filter(([, first, extra, why]) => !recordProblems("express", first, { t0, site, ...extra }).some((x) => why.test(x))).map(([n]) => n);
  assert.deepEqual(missed, []);
});

test("GATE-13: GATE-3's limits are the spec's — 60 s, 3 application lines, 1 config file", () => {
  assert.deepEqual({ LIMIT_S, MAX_CODE_LINES, MAX_CONFIG_FILES }, { LIMIT_S: 60, MAX_CODE_LINES: 3, MAX_CONFIG_FILES: 1 });
  console.log(`GATE-13: ${INSTALLS.length} planted installs and 6 planted records caught by GATE-3's own measures; the real install passes them`);
});
