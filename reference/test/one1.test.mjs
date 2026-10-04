// ONE-1 (+): an empty app gets the Gate and shows its first record within 60 seconds of the install
// starting — Express, and Next.js as a developer first runs it (`next dev`); the median of 3 runs.
//
// The clock runs from `npm install` of the packed `ludion` tarball (as npm would fetch it), through
// the lines the README shows (reference/<app>/install, the same overlay GATE-3 counts), the app's own
// start command and one automated request, to the moment the app's console prints the Gate's
// first-record line (gate-core firstRecordLine). The empty app's own dependencies are installed
// before the clock; after each run the Gate is uninstalled again, outside the clock.
//
// The line is checked for what it must say (the visit's class, method and route template) and for
// what it must not (an IP address, the query, the User-Agent): it is the site's own console.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REF, npm, pack, start, freePort, stopAll, raw } from "../harness.mjs";

after(stopAll);
const LIMIT_S = 60, RUNS = 3;
const LINE = /^ludion: recorded the first automated visit — .*$/m;
const UA = "python-requests/2.32.3";
const APP = {
  express: { start: "express", path: "/products/2?q=canary-q7", route: "GET /products/:id" },
  next: { start: "next-dev", path: "/products/2?q=canary-q7", route: "GET /products/:id" },
};
const dirs = {};
let tarball;

/** What is wrong with the first-record line in a console log. */
export function lineProblems(log, { route }) {
  const m = LINE.exec(log);
  if (!m) return ["no first-record line on the console"];
  const line = m[0], out = [];
  if (!line.includes("SUSPECTED")) out.push(`the line does not say what came (SUSPECTED): ${line}`);
  if (!line.includes(route)) out.push(`the line does not name the visit (${route}): ${line}`);
  if (/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])|::1|canary-q7|python-requests/.test(line)) out.push(`the line carries an IP, the query or the User-Agent: ${line}`);
  if ((log.match(new RegExp(LINE.source, "gm")) ?? []).length !== 1) out.push("the line is told more than once");
  return out;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const copyApp = (app, dir) => fs.cpSync(path.join(REF, app, "site"), dir, { recursive: true, filter: (p) => !/[\\/]node_modules([\\/]|$)/.test(p) });

before(() => {
  const packs = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-one1-pack-"));
  [tarball] = pack(["ludion"], packs);
  for (const app of Object.keys(APP)) {
    dirs[app] = fs.mkdtempSync(path.join(os.tmpdir(), `ludion-one1-${app}-`));
    copyApp(app, dirs[app]);
    npm(["ci", "--no-audit", "--no-fund"], dirs[app]); // the empty app, before the clock
  }
}, { timeout: 900_000 });

/** One run: install → the README's lines → start → one automated request → the line. Seconds. */
async function run(app, { plant, waitS = 180 } = {}) {
  const dir = dirs[app], spec = APP[app];
  const local = path.join(dir, path.basename(tarball));
  fs.copyFileSync(tarball, local); // the bytes npm would download
  const t0 = performance.now();
  npm(["install", "--no-audit", "--no-fund", local], dir);
  fs.cpSync(path.join(REF, app, "install"), dir, { recursive: true });
  plant?.(dir); // ONE-6: a Gate that does not tell, or tells too much
  const port = await freePort();
  const server = await start(spec.start, dir, port, { ready: false });
  try {
    for (;;) {
      if (server.child.exitCode != null) throw new Error(`${app} exited:\n${server.log.slice(-2000)}`);
      try { await raw(port, `GET ${spec.path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUser-Agent: ${UA}\r\nConnection: close\r\n\r\n`, { timeoutMs: 30_000 }); } catch { /* not up yet */ }
      if (LINE.test(server.log)) break;
      if (performance.now() - t0 > waitS * 1000) { if (plant) break; throw new Error(`${app}: no first-record line in ${waitS} s:\n${server.log.slice(-2000)}`); }
      await new Promise((r) => setTimeout(r, 100));
    }
    const s = (performance.now() - t0) / 1000;
    return { s, problems: lineProblems(server.log, spec) };
  } finally {
    await server.stop();
    // Back to the empty app, outside the clock.
    for (const f of fs.readdirSync(path.join(REF, app, "install"))) {
      const orig = path.join(REF, app, "site", f);
      if (fs.existsSync(orig)) fs.copyFileSync(orig, path.join(dir, f)); else fs.rmSync(path.join(dir, f), { force: true });
    }
    npm(["uninstall", "--no-audit", "--no-fund", "ludion"], dir);
    fs.rmSync(local, { force: true });
    fs.rmSync(path.join(dir, ".next"), { recursive: true, force: true });
  }
}

test("ONE-6: the judge refuses a missing line, and a line that names the visitor (planted)", () => {
  const ok = "ludion: recorded the first automated visit — SUSPECTED, GET /products/:id → allow. Records stay on this server for 7 days; only hourly counts may leave it.";
  assert.deepEqual(lineProblems(`ready\n${ok}\n`, APP.express), []);
  assert.match(lineProblems("ready\n", APP.express)[0], /no first-record line/);
  assert.match(lineProblems(ok.replace("GET /products/:id", "GET /products/:id from 203.0.113.9"), APP.express)[0], /IP/);
  assert.match(lineProblems(ok.replace("SUSPECTED", "SUSPECTED python-requests/2.32.3"), APP.express)[0], /User-Agent/);
  assert.match(lineProblems(`${ok}\n${ok}`, APP.express)[0], /more than once/);
});

// ONE-6 (−, first-record): a Gate that does not tell, or tells who the visitor is, fails ONE-1's
// measure — run for real, through the same install, start and request, with the server's Gate line
// planted.
const PLANTS = [
  ["a Gate that never tells", (dir) => edit(path.join(dir, "server.mjs"), (s) => s.replace("app.use(await ludion());", "app.use(await ludion({ announce: false }));")), /no first-record line/],
  ["a Gate that tells the visitor's address and User-Agent", (dir) => edit(path.join(dir, "server.mjs"), (s) => s.replace("app.use(await ludion());",
    'app.use(await ludion({ announce: (l) => console.info(l + " Visitor: 127.0.0.1, python-requests/2.32.3") }));')), /IP, the query or the User-Agent/],
  ["a Gate that tells every visit", (dir) => edit(path.join(dir, "server.mjs"), (s) => s.replace("app.use(await ludion());",
    "app.use(await ludion({ announce: (l) => { console.info(l); console.info(l); } }));")), /more than once/],
];
const edit = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, "utf8")));

test("ONE-6: a Gate that does not tell, or tells who the visitor is, fails ONE-1's measure (planted Gates, run for real)", { timeout: 900_000 }, async () => {
  const missed = [];
  for (const [name, plant, why] of PLANTS) {
    const r = await run("express", { plant, waitS: 20 });
    if (!r.problems.some((p) => why.test(p))) missed.push(`${name}: ${r.problems.join("; ") || "passed"}`);
  }
  assert.deepEqual(missed, []);
  console.log(`ONE-6: ${PLANTS.length} planted Gates (silent, naming the visitor, telling twice) failed ONE-1's measure, run for real on Express`);
});

for (const app of Object.keys(APP)) {
  test(`ONE-1: ${app} — install to the first record on the console in ≤ ${LIMIT_S} s (median of ${RUNS})`, { timeout: 900_000 }, async () => {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await run(app));
    for (const r of runs) assert.deepEqual(r.problems, []);
    const m = median(runs.map((r) => r.s));
    console.log(`ONE-1: ${app} ${runs.map((r) => r.s.toFixed(1)).join(" / ")} s, median ${m.toFixed(1)} s (limit ${LIMIT_S} s), from npm install to the line on the console`);
    assert.ok(m <= LIMIT_S, `median ${m.toFixed(1)} s > ${LIMIT_S} s`);
  });
}
