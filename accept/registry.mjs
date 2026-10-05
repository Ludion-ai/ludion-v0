// accept/registry.mjs — the executable spec. One entry per oracle in docs/MISSION.md §4.
// An entry without `run` is PENDING: that is the backlog. There is no other task list.
//
// Rules (docs/MISSION.md §1): add oracles and make them stricter freely. Never delete, loosen,
// or skip one without a human. `retired` is honoured only once every ID in `retireWhen` passes.
//
// fields: id, m (milestone), kind "+" positive | "-" negative | "±" both inside | "~" hygiene,
//   level 0 = seconds (Stop gate) | 1 = minutes (CI) | 2 = live (needs inputs),
//   pair = the negative oracle of the same property (LOOP-5), property = what the pair is about,
//   needs = env vars a human must provide, job = the CI job that runs it (default "loop"), title,
//   run() → { pass: boolean, metric?: string, detail?: string }
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sh(file, args, timeout = 180_000) {
  try { return { code: 0, out: execFileSync(file, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, maxBuffer: 64e6 }) }; }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` || String(e.message) }; }
}

/**
 * node:test files, optionally filtered by name. Zero matched tests is a FAIL, never a PASS.
 * `requires`: test names that must each have run and passed (a filter that happens to match only
 * some other test cannot pass the oracle; Codex audit #3).
 */
export const nodeTest = (files, pattern, { timeoutMs, metric, requires = [] } = {}) => async () => {
  // Pin the TAP reporter: Node ≥23 prints spec (no "# pass N") even when piped.
  const r = sh(process.execPath, ["--test", "--test-reporter=tap", ...(pattern ? [`--test-name-pattern=${pattern}`] : []), ...files], timeoutMs);
  const n = (k) => Number((new RegExp(`^# ${k} (\\d+)`, "m").exec(r.out) ?? [])[1] ?? 0);
  const pass = n("pass"), fail = n("fail");
  if (pass + fail === 0) return { pass: false, detail: "no test matched" };
  const ran = new Set([...r.out.matchAll(/^ok \d+ - (.+?)\s*$/gm)].map((m) => m[1]));
  const missing = requires.filter((t) => !ran.has(t));
  if (missing.length) return { pass: false, detail: `named tests did not run and pass: ${missing.join("; ")}` };
  return { pass: r.code === 0 && fail === 0, metric: [`${pass} tests`, metric?.(r.out)].filter(Boolean).join("; "), detail: fail ? `${fail} failing — ${firstFailure(r.out)}` : undefined };
};

/** The first failing test in TAP output and its error, so a red oracle in a CI log says why. */
export function firstFailure(out) {
  const m = /^not ok \d+ - (.+)\n([\s\S]*?)^ {2}\.\.\.$/m.exec(out);
  if (!m) return "(no failing test in the output: the file itself failed)";
  const block = m[2];
  let err = /^ {2}error: '((?:[^'\\]|\\.)*)'$/m.exec(block)?.[1];
  // A message with a single quote in it (a Windows path) is written double-quoted.
  if (err == null) { const d = /^ {2}error: "((?:[^"\\]|\\.)*)"$/m.exec(block)?.[1]; if (d != null) err = d.replace(/\\(.)/g, "$1"); }
  if (err == null) {
    const b = /^ {2}error: \|-?\n((?: {4}.*\n?)+)/m.exec(block);
    err = b ? b[1].split("\n").map((l) => l.trim()).filter((l) => l && l !== "+ actual - expected").slice(0, 10).join(" / ") : "";
  }
  if (!err) {
    // No message (an empty Error, a cancelled test, a failure in a hook): say what kind, and where.
    const field = (k) => new RegExp(`^ {2}${k}: '([^']*)'$`, "m").exec(block)?.[1];
    const stack = /^ {2}stack: \|-?\n {4}(.*)$/m.exec(block)?.[1]?.trim();
    err = [field("failureType") && `failureType ${field("failureType")}`, field("code") && `code ${field("code")}`, stack].filter(Boolean).join(", ") || "(no message)";
  }
  return `${m[1]}: ${err}`.slice(0, 900);
}

/** A node script; exit 0 is PASS. */
export const nodeScript = (file, args = [], { timeoutMs, metric } = {}) => async () => {
  const r = sh(process.execPath, [file, ...args], timeoutMs);
  const oks = (r.out.match(/^ok\s/gm) ?? []).length;
  return { pass: r.code === 0, metric: [oks ? `${oks} checks` : undefined, metric?.(r.out)].filter(Boolean).join("; ") || undefined,
    detail: r.code ? scriptFailure(r.out) : undefined };
};

/** Why a script oracle failed: its lines that say FAIL / Error / not ok first, else its last lines. */
export function scriptFailure(out) {
  const lines = out.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const loud = lines.filter((l) => /\b(FAIL|Error|ERR_|not ok|failed|problem)/.test(l));
  return (loud.length ? loud.slice(0, 3) : lines.slice(-3)).join(" | ").slice(0, 400);
};

/** Every part must pass. Metrics and details are joined. */
export const allOf = (...runs) => async () => {
  const rs = [];
  for (const run of runs) rs.push(await run());
  return { pass: rs.every((r) => r.pass), metric: rs.map((r) => r.metric).filter(Boolean).join(" + ") || undefined,
    detail: rs.map((r) => r.detail).filter(Boolean).join(" | ") || undefined };
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(m?[jt]s|cjs|py|go|rs)$/.test(e.name)) out.push(p);
  }
  return out;
}

export const ORACLES = [
  // ── M0 the loop ────────────────────────────────────────────────────────────────
  { id: "LOOP-1", m: "M0", kind: "~", level: 0, title: "MISSION.md catalog and registry hold the same IDs", run: async () => {
    const md = fs.readFileSync(path.join(ROOT, "docs/MISSION.md"), "utf8");
    const doc = new Set([...md.matchAll(/^\|\s*([A-Z]{2,5}-\d+)\s*\|/gm)].map((m) => m[1]));
    const reg = new Set(ORACLES.map((o) => o.id));
    const a = [...doc].filter((x) => !reg.has(x)), b = [...reg].filter((x) => !doc.has(x));
    return { pass: !a.length && !b.length, metric: `${doc.size} ids`,
      detail: [a.length && `unregistered: ${a}`, b.length && `undocumented: ${b}`].filter(Boolean).join("; ") || undefined };
  } },
  // The ratchet itself, tested (Codex audit #1, #2; accept/loop/ratchet.test.mjs, scripts/ratchet.mjs).
  { id: "LOOP-3", m: "M0", kind: "±", level: 0, title: "the ratchet's base: an existing ref yields its ratchet and IDs; a missing or broken one stops the scoreboard (non-zero) before any oracle runs",
    run: nodeTest(["accept/loop/ratchet.test.mjs"], "^LOOP-3:") },
  { id: "LOOP-4", m: "M0", kind: "±", level: 0, title: "a ratcheted oracle is held to PASS: FAIL, PENDING, SKIP for a missing input, a removal are regressions; every CI job an oracle names is run",
    run: nodeTest(["accept/loop/ratchet.test.mjs", "accept/loop/shard.test.mjs"], "^LOOP-4:") },
  // Pairs are the two sides of one property (MISSION.md §1.4); the catalog says what the registry says.
  { id: "LOOP-5", m: "M0", kind: "~", level: 0, title: "every pair is a − or ± oracle of the same property; MISSION.md's ± and 対 columns equal the registry",
    run: nodeTest(["accept/loop/pairs.test.mjs"], "^LOOP-5:", { metric: (out) => (/^# LOOP-5: (.+)$/m.exec(out) ?? [])[1] }) },
  // The latest push run on main, read from the GitHub API (accept/loop/ci-time.mjs). In the nightly
  // job: a PR cannot change the run main already had, and a slow main must not block its own fix.
  { id: "LOOP-2", m: "M0", kind: "~", level: 1, job: "nightly", title: "full CI run (every job a push to main starts, first start → last finish, all green) ≤10 min, without dropping or loosening any oracle; Windows runs the same oracles nightly",
    run: allOf(nodeTest(["accept/loop/ci-time.test.mjs"], "^LOOP-2:"), nodeScript("accept/loop/ci-time.mjs", [], { metric: (out) => (/^# LOOP-2: (.+)$/m.exec(out) ?? [])[1] })) },
  { id: "SEED-1", m: "M0", kind: "~", level: 0, title: "seed unit tests green", retireWhen: ["STD-1", "STD-2", "GATE-6", "REG-2", "PRS-1", "DIV-2", "DIV-3"],
    run: nodeTest(["packages/gate-core/test/core.test.mjs", "packages/diver/test/diver.test.mjs"]) },
  { id: "SEED-2", m: "M0", kind: "~", level: 0, title: "seed e2e: my agent → my Gate → VERIFIED", retireWhen: ["GATE-2", "GATE-7", "GATE-8", "PRIV-1", "DIV-1"],
    run: nodeScript("examples/e2e.mjs") },

  // ── M1 standards ───────────────────────────────────────────────────────────────
  // The vectors as cryptography (their lifetimes are past spec §10.4's 60 s); the Gate path is STD-5.
  { id: "STD-1", m: "M1", kind: "+", level: 0, pair: "STD-2", property: "signature-validity", title: "WG -00 App. E.2 Ed25519 vectors (E.2.1 dictionary, E.2.2 string) verify cryptographically with the Gate's library and key discovery; keyid = JWK thumbprint",
    run: nodeTest(["packages/gate-core/test/core.test.mjs"], "^(thumbprint matches|E\\.2\\.1 dictionary|E\\.2\\.2 legacy sf-string Signature-Agent verifies cryptographically)", { requires: [
      "thumbprint matches the draft's keyid for the RFC 9421 B.1.4 Ed25519 key",
      "E.2.1 dictionary Signature-Agent → VERIFIED (lifetime check relaxed for the far-future vector)",
      "E.2.2 legacy sf-string Signature-Agent verifies cryptographically (the library path, lifetime aside)",
    ] }) },
  // The vectors' shape signed again within 60 s, through the Gate itself (Codex audit #3's STD-1G).
  { id: "STD-5", m: "M1", kind: "+", level: 0, pair: "STD-2", property: "signature-validity", title: "the WG vectors' shape (E.2.1, E.2.2: same key, labels, components, tag) signed again within 60 s is VERIFIED by the real Gate (inspect and gate-node over HTTP)",
    run: nodeTest(["packages/gate-core/test/std5.test.mjs"], "^STD-5:", { requires: [
      "STD-5: the vector key is the published one (its thumbprint is the vectors' keyid)",
      "STD-5: E.2.1 (dictionary Signature-Agent), signed again within 60 s, is VERIFIED by the Gate as the vector's agent",
      "STD-5: E.2.2 (legacy string Signature-Agent), signed again within 60 s, is VERIFIED by the Gate (a verifier MAY accept it)",
      "STD-5: through the real Node adapter over HTTP, both forms are VERIFIED and reach the app",
    ] }) },
  { id: "STD-2", m: "M1", kind: "-", level: 1, property: "signature-validity", title: "tamper / wrong key / wrong authority / expired / future / >1h (>60s without a nonce) / wrong tag all rejected",
    run: nodeTest(["packages/gate-core/test/std2.test.mjs"], "^STD-2:") },
  // Cloudflare web-bot-auth (JS) and pyauth http-message-signatures (Python, hash-pinned venv in the OS temp dir).
  { id: "STD-3", m: "M1", kind: "+", level: 1, pair: "STD-2", property: "signature-validity", title: "interop both ways with ≥2 independent implementations (one non-JS)",
    timeoutMs: 600_000, run: nodeTest(["interop/std3.test.mjs"], "^STD-3:", { timeoutMs: 590_000,
      metric: (out) => {
        const pairs = /^# interop: (\d+\/\d+) /m.exec(out)?.[1], impl = /web-bot-auth ([\d.]+).*?http-message-signatures ([\d.]+)/m.exec(out);
        return [pairs && `${pairs} pairs`, impl && `web-bot-auth ${impl[1]} + pyauth ${impl[2]}`].filter(Boolean).join(", ");
      } }) },
  // The pins (accept/std4/pins.json) against the live datatracker, following replacements, with 7 days'
  // grace and the issue text for a draft that moved; and against every reference in the repository.
  // A datatracker that cannot be read is a FAIL. The checker's own failure paths run offline too.
  { id: "STD-4", m: "M1", kind: "~", level: 2, title: "pinned draft revisions == latest on datatracker (else issue; FAIL after 7 days)",
    run: allOf(nodeScript("accept/std4/run.mjs", [], { timeoutMs: 240_000, metric: (out) => (/^STD-4: (.+)$/m.exec(out) ?? [])[1] }),
      nodeTest(["accept/std4/drafts.test.mjs"], "^STD-4:")) },

  // ── M1 gate ────────────────────────────────────────────────────────────────────
  // Reference apps (Express, Next.js, Workers) are real installs in the OS temp dir, cached by content hash.
  { id: "GATE-1", m: "M1", kind: "+", level: 1, pair: "GATE-2", property: "pressure-on-automation", title: "humans untouched: responses byte-identical with/without Gate at P0–3 (reference apps)",
    timeoutMs: 1_800_000, run: nodeTest(["reference/test/harness.test.mjs", "reference/test/gate1.test.mjs"], "^GATE-1:", { timeoutMs: 1_750_000 }) },
  { id: "GATE-2", m: "M1", kind: "-", level: 1, property: "pressure-on-automation", title: "pressure bites: 100% of denials carry Ludion-Error + help Link (+Accept-Signature)",
    run: nodeTest(["packages/gate-node/test/gate2.test.mjs"], "^GATE-2:") },
  { id: "GATE-3", m: "M1", kind: "+", level: 1, pair: "GATE-13", property: "install-effort", title: "install ≤3 app lines, ≤1 config file, first classified event ≤60s (3 reference apps)",
    timeoutMs: 1_800_000, run: nodeTest(["reference/test/gate3.test.mjs"], "^GATE-3:", { timeoutMs: 1_750_000,
      metric: (out) => [...out.matchAll(/^# (express|next|workers): (\d+) app lines, (\d+) config file, first event ([^\n]+)$/gm)].map((m) => `${m[1]} ${m[2]}L/${m[3]}cfg/${m[4]}`).join(", ") }) },
  // GATE-3's other side: its measures (reference/gate3-measure.mjs) catch planted installs and records.
  { id: "GATE-13", m: "M1", kind: "-", level: 0, property: "install-effort", title: "GATE-3's measures cannot be passed by a bigger install or a Gate that does not deliver: planted installs (every line twice, edits beside it, a second config, a hand-edited package.json, a line the README does not show, nothing changed) and planted first records are caught; its limits are 60 s, 3 lines, 1 config",
    run: nodeTest(["reference/test/gate13.test.mjs"], "^GATE-13:", { metric: (out) => (/^# GATE-13: (.+)$/m.exec(out) ?? [])[1] }) },
  // spec §8 invariant 16: the Gate asks in HTTP, never in the page — through gate-node, gate-workers and
  // gate-next's proxy; planted adapters that append to the page or say more in a refusal are caught.
  { id: "GATE-14", m: "M1", kind: "±", level: 0, title: "the Gate never asks an AI in the page (spec §8 invariant 16): let through, the site's bytes, status and headers plus Ludion-* only; refused, Ludion-Error + Link and a body that says only { error, help } (node, workers, next); planted asks caught",
    run: nodeTest(["accept/gate14/gate14.test.mjs"], "^GATE-14", { metric: (out) => [...out.matchAll(/^# GATE-14 (node|workers|next|planted): (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`).join("; ") }) },
  { id: "GATE-4", m: "M1", kind: "+", level: 1, pair: "GATE-5", property: "added-latency", title: "added latency p99 ≤2ms warm (10k mixed requests)", timeoutMs: 180_000, run: async () => {
    // The real gate-node middleware timed per request, keys cached, every class in the mix; see the script.
    const r = sh(process.execPath, ["packages/gate-node/bench/gate4.mjs"], 170_000);
    let res;
    try { res = JSON.parse(r.out.trim().split("\n").pop()); } catch { return { pass: false, detail: r.out.trim().slice(-300) || "no result" }; }
    return { pass: r.code === 0 && res.pass === true, metric: `p50 ${res.p50}ms, p99 ${res.p99}ms (n=${res.n})`,
      detail: res.problems?.length ? res.problems.join("; ").slice(0, 300) : undefined };
  } },
  { id: "GATE-5", m: "M1", kind: "-", level: 1, property: "added-latency", title: "fail-open under fault injection at P0–1; fail_mode honoured at P2–3",
    run: nodeTest(["packages/gate-node/test/gate5.test.mjs"], "^GATE-5:") },
  { id: "GATE-6", m: "M1", kind: "-", level: 1, title: "SSRF sandbox: internal service receives 0 requests (incl. redirects, rebinding, bombs)",
    run: nodeTest(["packages/gate-node/test/gate6.test.mjs", "packages/gate-core/test/address.test.mjs"], "^GATE-6:") },
  { id: "GATE-7", m: "M1", kind: "-", level: 1, property: "attribution", title: "attack corpus accept/attacks/ 100% rejected; corpus only grows",
    run: allOf(nodeScript("accept/attacks/run.mjs"), nodeTest(["packages/gate-core/test/hardening.test.mjs", "packages/gate-node/test/route-evasion.test.mjs", "packages/gate-node/test/authority.test.mjs", "packages/gate-core/test/nonce-flood.test.mjs"], "^GATE-7:")) },
  // Real requests third parties' production agents sent (accept/gate8/real/*.json), with where they
  // were captured, when, and the directory as archived then. Each is shown authentic apart from the
  // Gate, then the Gate must name its agent; tampered, replayed, late or elsewhere, it never does.
  { id: "GATE-8", m: "M1", kind: "+", level: 1, pair: "GATE-7", property: "attribution", title: "a real third-party signed request (fixture with provenance) is VERIFIED",
    run: nodeTest(["accept/gate8/gate8.test.mjs"], "^GATE-8:", { metric: (out) => (/^# GATE-8: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "GATE-9", m: "M1", kind: "+", level: 1, pair: "GATE-7", property: "attribution", title: "the same conformance suite (STD vectors, GATE-7 corpus, STD-3 interop) passes in 6 ecosystems: Node, Workers, Deno/Bun, PHP+WordPress, Python, Go" },
  // The suite as data (accept/conformance/vectors.json, written by export.mjs from the GATE-7 families
  // and the WG vectors); the TypeScript Gate runs it from the file (portable/conformance.mjs), which
  // NEUT-1 also runs on Deno and workerd. Other languages read the same file (GATE-9).
  { id: "GATE-10", m: "M1", kind: "+", level: 1, pair: "GATE-7", property: "attribution", title: "the conformance suite is data: WG vectors, STD-2 and every GATE-7 attack as requests, one for one with their sources; the TS Gate passes it from the file",
    run: nodeTest(["accept/conformance/gate10.test.mjs"], "^GATE-10:", {
      metric: (out) => (/^# GATE-10: (.+)$/m.exec(out) ?? [])[1] }) },

  // The body a signature binds through its Content-Digest is the body the app gets (Codex audit #5):
  // through the real adapters (gate-node on a real HTTP server, gate-workers, gate-next).
  { id: "GATE-11", m: "M1", kind: "±", level: 1, title: "the signed body is the body: a covered Content-Digest is held to the bytes that arrive (Node, Workers, Next); the same headers with another body are never VERIFIED",
    run: nodeTest(["accept/body/gate11.test.mjs"], "^GATE-11:") },
  // GATE-6 held to @ludion/gate-next (Codex audit #7): the proxy as shipped, this process's DNS replaced.
  { id: "GATE-12", m: "M1", kind: "±", level: 1, title: "SSRF in the Next.js adapter: names resolving to non-public addresses reach the internal service 0 times; a public directory still VERIFIES",
    run: nodeTest(["packages/gate-next/test/gate12.test.mjs"], "^GATE-12:") },

  // ── M1 privacy ─────────────────────────────────────────────────────────────────
  { id: "PRIV-1", m: "M1", kind: "-", level: 1, title: "canary egress: 0 canaries, 0 raw IPs in any byte leaving the Gate (10k fuzzed)",
    run: nodeTest(["packages/gate-node/test/priv.test.mjs"], "^PRIV-1:") },
  { id: "PRIV-2", m: "M1", kind: "-", level: 1, title: "send_metadata=false → only key-directory fetches leave the process",
    run: nodeTest(["packages/gate-node/test/priv.test.mjs"], "^PRIV-2:") },
  { id: "PRIV-3", m: "M1", kind: "-", level: 1, title: "Registry receives no site origin/URL/path across the Diver lifecycle",
    run: nodeTest(["services/registry/test/priv3.test.mjs"], "^PRIV-3:", {
      metric: (out) => (/^# PRIV-3: (.+)$/m.exec(out) ?? [])[1] }) },
  // spec v2.0 §23.4: added PENDING (2026-10-03). Wired when built; until then they are the backlog.
  { id: "PRIV-4", m: "M1", kind: "-", level: 1, title: "only hourly aggregates leave the Gate (route template, method kind, class, decision, operator → count); no per-visit time, IP hash or country; per-visit records stay on the site 7 days (ADR-038)",
    run: nodeTest(["packages/gate-node/test/priv4.test.mjs"], "^PRIV-4:", { metric: (out) => (/^# PRIV-4: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "PRIV-5", m: "M1", kind: "-", level: 1, title: "Card Host keeps no IP, UA or time of whoever fetches a card or a key directory, anywhere",
    run: nodeTest(["packages/card-host/test/priv5.test.mjs"], "^PRIV-5:", { metric: (out) => (/^# PRIV-5: (.+)$/m.exec(out) ?? [])[1] }) },

  // ── M2 diver ───────────────────────────────────────────────────────────────────
  // A clean container pinned by digest (Linux CI, required there) or, elsewhere, an isolated temp dir; the metric says which ran.
  { id: "DIV-1", m: "M2", kind: "+", level: 1, pair: "DIV-3", property: "signing-key", title: "clean container → init → VERIFIED ≤180s (TS and Python)",
    timeoutMs: 1_200_000, run: nodeTest(["clean-room/div1.test.mjs"], "^DIV-1:", { timeoutMs: 1_150_000,
      metric: (out) => [...out.matchAll(/^# div1 (ts|py): ([\d.]+)s (container|fallback)/gm)].map((m) => `${m[1]} ${m[2]}s ${m[3]}`).join(", ") }) },
  { id: "DIV-2", m: "M2", kind: "+", level: 1, pair: "DIV-3", property: "signing-key", title: "Card is a valid CIMD Signature Agent Card and resolves end to end",
    run: nodeTest(["packages/card-host/test/div2.test.mjs"], "^DIV-2:") },
  { id: "DIV-3", m: "M2", kind: "-", level: 1, property: "signing-key", title: "Root key never signs, never in the directory, never plaintext on disk outside dev",
    run: nodeTest(["packages/diver/test/div3.test.mjs"], "^DIV-3:") },
  // The npm publish set (accept/publish/set.mjs): packed tarballs into a clean project; the CLI and
  // every Gate adapter work from published names only. Third-party deps come from the registry.
  // init's one screen and its one optional question (spec §9.2, §13.1; the human's order 2026-10-03).
  { id: "DIV-5", m: "M2", kind: "±", level: 0, property: "init-screen", title: "npx ludion init shows one screen: the AI's name, the same name on the web (Signature-Agent) and on MCP (client_id), the revoke line, a README badge; none of Depth/Ballast/Mandate/Pressure/Staple, no secret (en, ja, custom domain)",
    run: nodeTest(["packages/diver/test/div5.test.mjs"], "^DIV-5:", { metric: (out) => (/^# DIV-5: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "DIV-6", m: "M2", kind: "-", level: 0, property: "init-question", title: "init's optional question sends nothing unless answered (no terminal, CI, skipped, nonsense: 0 network attempts); an answer is one POST of one word, with no Diver id, name, contact or key",
    run: nodeTest(["packages/diver/test/div5.test.mjs"], "^DIV-6:") },
  { id: "DIV-7", m: "M2", kind: "±", level: 0, title: "ludion doctor checks the clock against the agent's own origin (its Date header): in step or 20 s off passes, no Date header is said and not failed; more than ±30 s off (45 s, 5 min, a day; ahead or behind) is a problem naming the skew and how to sync",
    run: nodeTest(["packages/diver/test/doctor.test.mjs"], "^DIV-7:") },
  { id: "PUB-1", m: "M2", kind: "+", level: 1, pair: "PUB-2", property: "published-tarball", title: "npm tarballs alone install into a clean project; ludion CLI and gate-node/workers/next work (my agent → my Gate → VERIFIED)",
    timeoutMs: 900_000, run: nodeTest(["accept/publish/pub1.test.mjs"], "^PUB-1:", { timeoutMs: 880_000,
      metric: (out) => (/^# PUB-1: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "PUB-2", m: "M2", kind: "-", level: 1, property: "published-tarball", title: "each tarball ships only its declared files (no tests, fixtures, keys, env, identities) and is publishable as is",
    run: nodeTest(["accept/publish/pub2.test.mjs"], "^PUB-2:", { metric: (out) => (/^# PUB-2: (.+)$/m.exec(out) ?? [])[1] }) },
  // The CLI first, alone (the human's order, 2026-10-01): its tarball installs with every @ludion/*
  // fetch refused, and works as the repo's CLI does. Packed as npm publish packs (prepack, postpack).
  { id: "PUB-3", m: "M2", kind: "+", level: 1, pair: "PUB-2", property: "published-tarball", title: "the ludion tarball alone installs into a clean project with no @ludion/* on npm; the CLI works (scan, report equal the repo's; init + sign)",
    timeoutMs: 900_000, run: nodeTest(["accept/publish/pub3.test.mjs"], "^PUB-3:", { timeoutMs: 880_000 }) },
  // The one way the set leaves the repository: the release workflow, by hand on main, OIDC only (docs/PUBLISH.md §6).
  { id: "PUB-4", m: "M2", kind: "±", level: 0, title: "npm publishing goes only through the release workflow: started by hand on main, approved at the npm environment, trusted publishing (OIDC, no npm token anywhere), the set's order, after PUB-1..3; a package npm never saw is refused; the first failure stops the rest",
    run: nodeTest(["accept/publish/pub4.test.mjs"], "^PUB-4:", { metric: (out) => (/^# PUB-4: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "DIV-4", m: "M2", kind: "±", level: 1, title: "session key rotation keeps the identifier; old key stops, new key works",
    run: nodeTest(["packages/diver/test/div4.test.mjs"], "^DIV-4:") },

  // ── M3 registry ────────────────────────────────────────────────────────────────
  { id: "REG-1", m: "M3", kind: "+", level: 1, pair: "REG-2", property: "staple-validity", title: "Registry down → Gates keep verifying within Staple TTL",
    run: nodeTest(["services/registry/test/reg1.test.mjs"], "^REG-1:") },
  { id: "REG-2", m: "M3", kind: "-", level: 0, property: "staple-validity", title: "Staple attacks rejected (unknown kid, >1h, expired, iss, cnf, sub)",
    run: nodeTest(["packages/gate-core/test/core.test.mjs"], "^Staple:") },
  { id: "REG-3", m: "M3", kind: "±", level: 1, title: "revocation reaches subscribed Gates ≤60s, others ≤ Staple TTL",
    run: nodeTest(["services/registry/test/reg3.test.mjs"], "^REG-3:", {
      metric: (out) => (/^# REG-3: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "REG-4", m: "M3", kind: "-", level: 1, title: "no private key material in git history, logs, or build artifacts",
    run: nodeScript("accept/keyscan/run.mjs") },
  // spec v2.0 §23.4: added PENDING (2026-10-03). Wired when built; until then they are the backlog.
  { id: "REG-5", m: "M3", kind: "±", level: 1, title: "the registry's bulk distribution is signed, and the recipients' lookups are not recorded",
    run: nodeTest(["services/registry/test/reg5.test.mjs"], "^REG-5:", { metric: (out) => [...out.matchAll(/^# REG-5: (.+)$/gm)].map((m) => m[1]).join("; ") || undefined }) },
  // spec §8 invariant 14: trust is not sold — the Staple's standing (Depth, Ballast, operator check)
  // moves with the confirmed contact and the commitments only; money in a statement or a record does
  // not move it; planted standings that money raises are caught.
  { id: "REG-6", m: "M3", kind: "±", level: 0, title: "Depth does not rise with money (spec §8 invariant 14): the Staple's standing moves with the confirmed contact and the commitments only — not with a paid statement, a plan written into the record, or any other field; no route takes a payment; planted standings caught",
    run: nodeTest(["services/registry/test/reg6.test.mjs"], "^REG-6", { metric: (out) => (/^# REG-6: (.+)$/m.exec(out) ?? [])[1] }) },
  // HN day (the human's instruction, 2026-10-04): new registrations are limited per IP, per contact and in
  // all, by the production config, without keeping an address; and they can be paused while every
  // existing name keeps working.
  { id: "REG-7", m: "M3", kind: "±", level: 0, title: "new registrations are limited (per IP per hour, per contact per day, in all per hour) by the production config, through the Durable Object, keeping no address; a pause stops new names only; planted unlimited and ignored-pause registries caught",
    run: nodeTest(["services/registry/test/reg7.test.mjs"], "^REG-7", { metric: (out) => (/^# REG-7: (.+)$/m.exec(out) ?? [])[1] }) },
  // The Registry keeps no contact (the human's decision, 2026-10-05): a leak of the Registry leaks no email.
  { id: "LEAK-1", m: "M3", kind: "±", level: 0, title: "the Registry keeps no contact: registrations carrying canary contacts (again, revoked) leave none — plain, any case or base64url — in what it stores, the bulk copy, cards, client documents, public records, Staples or its responses; a kept signed statement and a card with the contact are caught",
    run: nodeTest(["services/registry/test/leak1.test.mjs"], "^LEAK-1", { metric: (out) => (/^# LEAK-1: (.+)$/m.exec(out) ?? [])[1] }) },

  // ── M4 fear → number ───────────────────────────────────────────────────────────
  { id: "SCAN-1", m: "M4", kind: "+", level: 1, pair: "SCAN-5", property: "parse-rate", title: "scan parse rate ≥99% across the log-format corpus",
    run: nodeTest(["packages/scan/test/scan1.test.mjs"], "^SCAN-1:") },
  { id: "SCAN-2", m: "M4", kind: "±", level: 1, title: "scan counts equal ground truth on labelled fixtures (incl. the critical-route number)",
    run: nodeTest(["packages/scan/test/scan2.test.mjs"], "^SCAN-2:") },
  { id: "SCAN-3", m: "M4", kind: "-", level: 1, title: "scan output has no raw IP / query value / untemplated path; zero network",
    run: nodeTest(["packages/scan/test/scan3.test.mjs"], "^SCAN-3:") },
  { id: "SCAN-4", m: "M4", kind: "+", level: 1, pair: "SCAN-6", property: "scan-throughput", title: "1 GB of logs in ≤60s", timeoutMs: 300_000, run: async () => {
    // 1 GiB generated in a temp dir (untimed), then the real CLI timed end to end; see the script.
    const r = sh(process.execPath, ["packages/scan/bench/scan4.mjs"], 290_000);
    let res;
    try { res = JSON.parse(r.out.trim().split("\n").pop()); } catch { return { pass: false, detail: r.out.trim().slice(-300) || "no result" }; }
    return { pass: r.code === 0 && res.pass === true, metric: `${res.seconds}s for 1 GiB, ${res.mbps} MB/s`,
      detail: res.problems?.length ? res.problems.join("; ").slice(0, 300) : undefined };
  } },
  // The other side of SCAN-1 and SCAN-4: a damaged corpus is reported as damaged; planted fast-but-wrong CLIs fail the bench.
  { id: "SCAN-5", m: "M4", kind: "-", level: 1, property: "parse-rate", title: "the parse rate never flatters: with 3% of records damaged in every format, exactly those are unparsed, the denominator holds, every file reports under 99% (file and CLI); planted lenient parsers are caught",
    run: nodeTest(["packages/scan/test/scan5.test.mjs"], "^SCAN-5:", { metric: (out) => (/^# SCAN-5: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "SCAN-6", m: "M4", kind: "-", level: 1, property: "scan-throughput", title: "SCAN-4's speed cannot be had without the work: its bench fails planted CLIs that count half, skip classifying, run over the limit, print no report or exit non-zero; the real CLI passes the same bench",
    run: nodeTest(["packages/scan/test/scan6.test.mjs"], "^SCAN-6:", { metric: (out) => (/^# SCAN-6: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "RPT-1", m: "M4", kind: "±", level: 1, title: "daily report equals ground truth; ja + en, HTML + text",
    run: nodeTest(["packages/report/test/rpt1.test.mjs"], "^RPT-1:") },
  // Read or write is the Gate's call ("writes": false is a read), carried as `access` in the record and the
  // hourly key; the suspicious rules and the morning report go by it alone, never the method or the config.
  { id: "RPT-2", m: "M4", kind: "±", level: 0, title: "read or write is the Gate's call (a route marked writes: false is a read): the record and the hourly key carry access, no method; suspected fakes, critical touches and said-vs-did go by it alone; the report imports no site config; planted Gate, report and count caught",
    run: nodeTest(["packages/report/test/rpt2.test.mjs"], "^RPT-2", { metric: (out) => (/^# RPT-2: (.+)$/m.exec(out) ?? [])[1] }) },

  // ── M5 pressure, neutrality, crypto ────────────────────────────────────────────
  { id: "PRS-1", m: "M5", kind: "±", level: 1, title: "100k random cases: UNKNOWN always passes; denials only at P≥2 on matching routes",
    run: nodeTest(["packages/gate-core/test/prs1.test.mjs"], "^PRS-1:") },
  // The Registry in process, real Node Gates over HTTP (one subscribed to the revocation stream, one
  // not, one at another site), and a software passkey producing real WebAuthn assertions (ES256 in
  // DER, EdDSA) for the Principal's consent (services/registry/test/passkey.mjs).
  { id: "PRS-2", m: "M5", kind: "±", level: 1, title: "Mandate v0: in scope/limit passes; out of scope/over limit/expired/revoked denied",
    run: nodeTest(["services/registry/test/prs2.test.mjs"], "^PRS-2:", {
      metric: (out) => (/^# PRS-2: (.+)$/m.exec(out) ?? [])[1] }) },
  // A Mandate's per_day is the site's, across all of its Gates (Codex audit #4; the rule is the human's):
  // one shared record, updated atomically — two Gate processes on one SQLite ledger, racing; the
  // Registry holds no spend; a Gate with no shared record refuses a counted Mandate (fail closed).
  { id: "PRS-3", m: "M5", kind: "±", level: 1, title: "Mandate limits are the site's: per_day counted once across all its Gates (two processes, racing); no shared record → counted Mandates refused",
    run: nodeTest(["packages/gate-node/test/prs3.test.mjs", "packages/gate-node/test/ledger.test.mjs"], "^PRS-3:") },
  // Overlapping routes (Codex audit #8; the rule is the human's, 2026-10-01): the strictest wins.
  // Expectations computed from the rule route by route, never from forPath(); and over real HTTP.
  { id: "PRS-4", m: "M5", kind: "±", level: 1, title: "overlapping routes: the strictest wins (highest Pressure, every requirement), whatever the order; a leading /** at P0 never lowers /checkout",
    run: nodeTest(["packages/gate-core/test/prs4.test.mjs"], "^PRS-4:") },
  // Mandate's first use (the human's decision, 2026-10-05): closing an account. The demo site's own handler
  // and config, end to end: only its user's Mandate (scope delete, this site) gets an AI through.
  { id: "PRS-5", m: "M5", kind: "±", level: 1, title: "the demo site's POST /account/delete: only an AI with its user's Mandate (scope delete, this site) closes the account the Mandate names; no Mandate, another site, withdrawn → mandate_required; another scope → mandate_scope; another agent's carry refused; people untouched; planted Gates caught",
    timeoutMs: 300_000, run: nodeTest(["services/registry/test/prs5.test.mjs"], "^PRS-5", { timeoutMs: 280_000, metric: (out) => (/^# PRS-5: (.+)$/m.exec(out) ?? [])[1] }) },
  // The same portable suite on Node, Deno (no permissions) and workerd, against the npm-packed
  // packages; pinned runtimes in accept/neutral/runtime, installed in the OS temp dir (ADR-027).
  { id: "NEUT-1", m: "M5", kind: "+", level: 1, pair: "NEUT-2", property: "neutrality", title: "gate-core and Card Host pass the same suite on ≥2 independent runtimes",
    timeoutMs: 900_000, run: nodeScript("accept/neutral/runtimes.mjs", [], { timeoutMs: 880_000,
      metric: (out) => [...out.matchAll(/^ok (node|deno|workerd) (\S+).*?: (\d+)\/(\d+)/gm)].map((m) => `${m[1]} ${m[2]} ${m[3]}/${m[4]}`).join(", ") }) },
  // Lockfile-resolved tree of gate-core and Card Host: vendor names, vendor-org repositories, vendor
  // endpoints in code; standard reference implementations only by exact name@version (ADR-027).
  { id: "NEUT-2", m: "M5", kind: "-", level: 1, property: "neutrality", title: "no CDN/cloud vendor SDK in gate-core's dependency tree",
    run: nodeScript("accept/neutral/deps.mjs") },
  // gitleaks pinned by version and SHA-256 (accept/gitleaks/gitleaks.mjs), with .gitleaks.toml's narrow exceptions (ADR-042).
  { id: "SEC-1", m: "M5", kind: "±", level: 1, title: "0 secrets in the git history and the working tree (gitleaks); planted secrets — in a file, a deleted commit, the excepted files — are found",
    timeoutMs: 600_000, run: nodeTest(["accept/gitleaks/sec1.test.mjs"], "^SEC-1:", { timeoutMs: 590_000, metric: (out) => (/^# SEC-1: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "CRY-1", m: "M5", kind: "-", level: 0, title: "no home-made crypto: primitives only inside allowlisted modules", run: async () => {
    const allow = new Set(["packages/gate-core/src/staple.mjs", "packages/gate-core/src/receipt.mjs", "packages/diver/src/keys.mjs"]);
    // WebCrypto (also via a destructured `subtle`), node:crypto's cipher / KDF / signing / key
    // construction calls, and third-party primitive libraries. Hashing and randomness are fine.
    const banned = new RegExp([
      String.raw`\bsubtle\.(sign|verify|importKey|generateKey|deriveKey|deriveBits|encrypt|decrypt|wrapKey|unwrapKey)\b`,
      String.raw`\b(createCipheriv|createDecipheriv|scrypt|scryptSync|pbkdf2|pbkdf2Sync|hkdf|hkdfSync|createSign|createVerify|createPrivateKey|createPublicKey|createSecretKey|generateKeyPair|generateKeyPairSync|generateKeySync|diffieHellman|createDiffieHellman|createECDH|publicEncrypt|privateDecrypt|privateEncrypt|publicDecrypt)\s*\(`,
      String.raw`\bcrypto\.(sign|verify)\s*\(`,
      String.raw`import\s*\{[^}]*\b(sign|verify)\b[^}]*\}\s*from\s*["'](node:)?crypto["']`,
      String.raw`(from\s+|import\s*\(\s*|require\s*\(\s*)["'](tweetnacl|tweetnacl-util|elliptic|node-forge|crypto-js|@noble\/[\w-]+|libsodium[\w-]*|sodium-native|jsrsasign|node-rsa|sjcl)(\/[\w./-]*)?["']`,
    ].join("|"));
    const hits = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "services"))]
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/")).filter((f) => !/(^|\/)test\//.test(f) && !allow.has(f))
      .filter((f) => banned.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    return { pass: hits.length === 0, metric: `${allow.size} allowlisted`, detail: hits.length ? `outside allowlist: ${hits.join(", ")}` : undefined };
  } },

  // ── M6 the real world (needs human inputs) ─────────────────────────────────────
  { id: "LIVE-1", m: "M6", kind: "+", level: 2, needs: ["CLOUDFLARE_API_TOKEN"], title: "canary Gate (P0, *.workers.dev) up; hourly signed probe VERIFIED; ≥99.9%/week" },
  { id: "LIVE-2", m: "M6", kind: "+", level: 2, pair: "GATE-7", property: "attribution", needs: ["LUDION_CANARY_READ_TOKEN"], title: "a real third-party agent is VERIFIED on the canary at least daily" },
  { id: "LIVE-3", m: "M6", kind: "+", level: 2, needs: ["LUDION_CLOUD_READ_TOKEN"], title: "North Star: Verified Actions/day computed from Cloud events, on the scoreboard" },
  // The human's condition (2026-10-04) for WEB-1 measuring preview versions through a relay that removes
  // Cloudflare's noindex: production ludion.ai is shown, separately, not to send it. Nightly: an outage
  // of ludion.ai must never block a PR.
  { id: "LIVE-4", m: "M6", kind: "±", level: 2, job: "nightly", title: "production ludion.ai serves a build of site/ and no page says noindex (X-Robots-Tag or a robots meta): every sitemap page, the home, a 404; planted forms of noindex caught",
    run: allOf(nodeTest(["accept/live/live4.test.mjs"], "^LIVE-4"), nodeScript("accept/live/live4.mjs", [], { timeoutMs: 240_000, metric: (out) => (/^# LIVE-4: (.+)$/m.exec(out) ?? [])[1] })) },

  // ── M7 web: the site, the /e/<code> help pages, the in-browser scan ──────────────
  // The live preview (site/preview.json from `npm run deploy:preview`) serves THIS checkout's build
  // (_build.json = siteHash(), every page byte-identical), and Lighthouse on every preview page ≥95.
  // CI job "preview" deploys this checkout's site to the preview first (the agent-only Cloudflare
  // token, a GitHub secret), then runs it; the "loop" jobs leave it to that job. Locally it checks the
  // preview as last deployed (npm run deploy:preview). It never SKIPs: a ratcheted oracle cannot (LOOP-4).
  { id: "WEB-1", m: "M7", kind: "+", level: 1, pair: "WEB-5", property: "site-integrity", job: "preview", title: "static site deployed to preview; every page in ja + en; Lighthouse mobile P/A/BP/SEO all ≥95",
    timeoutMs: 1_800_000, run: nodeTest(["site/test/web1.test.mjs"], "^WEB-1:", { timeoutMs: 1_780_000, metric: (out) => (/^# WEB-1: (.+)$/m.exec(out) ?? [])[1] }) },
  // The copy check (site/test/copy.mjs) on the real build: the legal line of spec §14 in English and
  // Japanese, and every figure linked to the repository document that states it; claims and
  // unsourced figures planted in built pages must be caught.
  { id: "WEB-2", m: "M7", kind: "-", level: 1, title: "copy check: 0 insurance / guarantee / 100%-safe claims (spec §14); every number links to its source",
    timeoutMs: 900_000, run: nodeTest(["site/test/web2.test.mjs"], "^WEB-2:", { timeoutMs: 880_000,
      metric: (out) => (/^# WEB-2: (.+)$/m.exec(out) ?? [])[1] }) },
  // The site is its own npm project (ADR-040), installed from site/package-lock.json and built
  // once per content hash into the OS temp dir by site/build.mjs; the codes come from the Gate.
  { id: "WEB-3", m: "M7", kind: "+", level: 1, pair: "WEB-5", property: "site-integrity", title: "every Gate error code has /e/<code> in ja + en (what happened, 3-minute path to VERIFIED); 0 missing",
    timeoutMs: 900_000, run: nodeTest(["site/test/web3.test.mjs"], "^WEB-3:", { timeoutMs: 880_000,
      metric: (out) => (/^# WEB-3: (.+)$/m.exec(out) ?? [])[1] }) },
  // Headless Chromium: playwright-core from the site's lockfile, its pinned browser build installed on
  // first use into Playwright's cache (site/test/browser.mjs). The page runs packages/scan's own core.
  { id: "WEB-4", m: "M7", kind: "+", level: 1, pair: "WEB-11", property: "scan-equivalence", title: "in-browser scan at /scan equals the CLI on SCAN fixtures; 200 MB in ≤30s (headless Chromium)",
    timeoutMs: 900_000, run: nodeTest(["site/test/web4.test.mjs"], "^WEB-4:", { timeoutMs: 880_000,
      metric: (out) => (/^# WEB-4: (.+)$/m.exec(out) ?? [])[1] }) },
  // The allowlist is the site's own origin. Every page of the real build, desktop and mobile, is used
  // in Chromium behind the egress watch; links are checked in the files and in the live DOM
  // (site/test/links.mjs); links out are asked on the network, and breakage planted must be caught.
  { id: "WEB-5", m: "M7", kind: "-", level: 1, property: "site-integrity", title: "0 broken links, 0 console errors, 0 requests outside the allowlist",
    timeoutMs: 900_000, run: nodeTest(["site/test/web5.test.mjs"], "^WEB-5:", { timeoutMs: 880_000,
      metric: (out) => (/^# WEB-5: (.+)$/m.exec(out) ?? [])[1] }) },
  // Chromium's only way out is a proxy in the test (site/test/egress.mjs), loopback included; the
  // test also plants leaks in the page and the worker and must catch each one.
  { id: "WEB-6", m: "M7", kind: "-", level: 1, title: "scan leaks no log byte: canary log → 0 external requests after page load (every request watched)",
    timeoutMs: 900_000, run: nodeTest(["site/test/web6.test.mjs"], "^WEB-6:", { timeoutMs: 880_000,
      metric: (out) => (/^# WEB-6: (.+)$/m.exec(out) ?? [])[1] }) },
  // The launch docs' install steps, run (the human's decision, 2026-10-04: Node, Next.js, Workers; FastAPI,
  // WordPress and Python are planned after the launch): /gate followed section by section on the
  // reference sites before the Gate (reference/harness.mjs prepareFrom), then run as a reader runs them.
  { id: "WEB-7", m: "M7", kind: "+", level: 1, pair: "WEB-12", property: "launch-docs", title: "docs are tests (Node, Next.js, Workers): /gate followed on a site without the Gate — npm install ludion, the page's lines and config — runs: a person gets the page, a crawler's name is DECLARED, the console's first-visit line once",
    timeoutMs: 1_800_000, run: nodeTest(["site/test/web7.test.mjs"], "^WEB-7", { timeoutMs: 1_780_000, metric: (out) => (/^# WEB-7: (.+)$/m.exec(out) ?? [])[1] }) },
  // The site as it deploys to Workers (site/edge: the build's static files and POST /api/signup), run
  // by wrangler dev in workerd with a webhook stub as the notifier (site/test/edge.mjs); the form is
  // used in Chromium, and faults planted in the endpoint must be caught. The deployed preview is WEB-1's.
  // The deploy artifact in workerd: ja/en pairing, and Lighthouse mobile ≥95 on one page per template in
  // both languages. The runner is first shown to fail a planted degraded page.
  { id: "WEB-9", m: "M7", kind: "+", level: 1, pair: "WEB-5", property: "site-integrity", title: "deploy artifact in workerd: every page ja + en; Lighthouse mobile ≥95 on every template (en, ja)",
    timeoutMs: 1_200_000, run: nodeTest(["site/test/web9.test.mjs"], "^WEB-9:", { timeoutMs: 1_180_000, metric: (out) => (/^# WEB-9: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "WEB-8", m: "M7", kind: "±", level: 1, title: "signup form: a preview submission reaches the notifier (stub ok); honeypot and rate limit drop bots",
    timeoutMs: 900_000, run: nodeTest(["site/test/web8.test.mjs"], "^WEB-8:", { timeoutMs: 880_000,
      metric: (out) => (/^# WEB-8: (.+)$/m.exec(out) ?? [])[1] }) },
  // The quickstart page as a test (the Express and CLI part of WEB-7, which stays open for the rest):
  // its blocks run in order in a clean directory, @ludion/* from the publish set's tarballs; what the
  // page shows is what they print. The agent's request is VERIFIED by a Gate given the directory init
  // wrote (agent.example.com is not ours to publish on), and a tampered copy is not.
  { id: "WEB-10", m: "M7", kind: "±", level: 1, title: "the quickstart page runs as written: the Gate at P0 classifies (DECLARED; a browser UNKNOWN, same page); init + sign → VERIFIED with the directory init wrote, a tampered copy not",
    timeoutMs: 1_200_000, run: nodeTest(["site/test/web10.test.mjs"], "^WEB-10:", { timeoutMs: 1_180_000,
      metric: (out) => (/^# WEB-10: (.+)$/m.exec(out) ?? [])[1] }) },

  // The Install-the-Gate page as a test (the /gate part of WEB-7, which stays open for the rest): its
  // Express, Next.js and Workers sections, in both languages, are exactly the reference installs GATE-1
  // and GATE-3 run (site/test/gate-page.mjs); planted pages and a planted install are caught.
  { id: "WEB-12", m: "M7", kind: "±", level: 0, property: "launch-docs", title: "/gate (en, ja) shows exactly the installs GATE-1 and GATE-3 run — Express, Next.js, Workers: npm install ludion, every installed line shown and nothing else, the same config; planted pages and installs caught",
    run: nodeTest(["site/test/web12.test.mjs"], "^WEB-12", { metric: (out) => (/^# WEB-12: (.+)$/m.exec(out) ?? [])[1] }) },
  // The "Sign from code" page as a test (the TypeScript part of WEB-7): its blocks in order in a clean
  // directory with the publish set's tarball — a signed request VERIFIED, a purpose on the receipt, and
  // the MCP token exchange MCP-1 makes, at a stub that checks the assertion; en and ja carry the same code.
  { id: "WEB-13", m: "M7", kind: "±", level: 1, title: "/agent (en = ja) runs as written: ludionFetch → 200 VERIFIED, a purpose → 200 read, token.mjs → the private_key_jwt exchange MCP-1 makes (client_id = name + /client); planted pages caught",
    timeoutMs: 1_200_000, run: nodeTest(["site/test/web13.test.mjs"], "^WEB-13", { timeoutMs: 1_180_000, metric: (out) => (/^# WEB-13: (.+)$/m.exec(out) ?? [])[1] }) },

  // WEB-4's comparison (site/test/scan-check.mjs) run against copies of the built site with a fault
  // planted in the worker, the page or the shipped sample: each is caught by its rule, an untouched copy passes.
  { id: "WEB-11", m: "M7", kind: "-", level: 1, property: "scan-equivalence", title: "WEB-4's check bites: a scan worker that miscounts or leaves a file out, a headline from another field, a swapped or cut-short sample are each caught; an untouched copy passes",
    timeoutMs: 900_000, run: nodeTest(["site/test/web11.test.mjs"], "^WEB-11:", { timeoutMs: 880_000,
      metric: (out) => (/^# WEB-11: (.+)$/m.exec(out) ?? [])[1] }) },

  // ── M8 pilots: the Gate in front of real sites ─────────────────────────────────────────
  // tracecheck.dev (pilots/tracecheck): a zone-route Worker a person deploys. In Node (D1 on node:sqlite,
  // planted faults) and in workerd (the deployable bundle in front of a stub site).
  { id: "PILOT-1", m: "M8", kind: "±", level: 1, title: "tracecheck.dev pilot: every response is the site's own (bytes and headers); only automation (and requests for probe paths, as the list's label) is recorded, with no query, address or free text; the morning report is posted, with the hunt for secrets and admin pages; faults never reach a visitor",
    timeoutMs: 600_000, run: nodeTest(["pilots/tracecheck/test/pilot.test.mjs", "pilots/tracecheck/test/workerd.test.mjs"], undefined, { timeoutMs: 580_000, requires: [
      "PILOT-1 (workerd): the site's response, untouched; automation recorded; a report posted",
      "faults stay in the pilot: a dead D1, a refused config, a throwing Gate never touch the response",
    ] }) },
  // The deployed pilot, read through the Cloudflare API with a person's read-only token.
  { id: "PILOT-2", m: "M8", kind: "+", level: 2, needs: ["TRACECHECK_D1_READ_TOKEN", "TRACECHECK_ACCOUNT_ID", "TRACECHECK_D1_ID"],
    title: "tracecheck.dev live: each of the last 7 full days (Tokyo) has recorded automation and a saved morning report",
    run: nodeScript("pilots/tracecheck/live.mjs") },

  // ── M9 the one point (spec v2.0 §9.3, §23.4) ─────────────────────────────────────────────
  // One line gives an AI its own key and name, the same on MCP and the web, and one line erases it;
  // the Gate reads the name, matches the declared purpose, and a block is one line in the site's
  // own config. Added PENDING (2026-10-03); wired when built.
  { id: "ONE-1", m: "M9", kind: "+", level: 1, pair: "ONE-6", property: "first-record", title: "an empty Next.js and Express app: Gate install → first record visible ≤60s (median of 3)",
    timeoutMs: 1_500_000, run: nodeTest(["reference/test/one1.test.mjs"], "^ONE-1:", { timeoutMs: 1_480_000, metric: (out) => [...out.matchAll(/^# ONE-1: (.+)$/gm)].map((m) => m[1]).join("; ") || undefined }) },
  { id: "ONE-6", m: "M9", kind: "-", level: 1, property: "first-record", title: "a Gate that does not tell, tells who the visitor is, or tells every visit fails ONE-1's measure (planted Gates, run for real on Express)",
    timeoutMs: 900_000, run: nodeTest(["reference/test/one1.test.mjs"], "^ONE-6:", { timeoutMs: 880_000, metric: (out) => (/^# ONE-6: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "ONE-2", m: "M9", kind: "+", level: 1, pair: "ONE-7", property: "morning-report", title: "the morning report has one headline number and one main decision",
    run: nodeTest(["packages/report/test/one2.test.mjs"], "^ONE-2:", { metric: (out) => (/^# ONE-2: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "ONE-7", m: "M9", kind: "-", level: 0, property: "morning-report", title: "a report with two headline numbers, no decision or two decisions is caught by ONE-2's judge (planted reports)",
    run: nodeTest(["packages/report/test/one2.test.mjs"], "^ONE-7:") },
  { id: "ONE-3", m: "M9", kind: "±", level: 1, title: "let through / wall / stop take effect with one config line and undo with one; the human path's diff is 0 (GATE-1)",
    run: nodeTest(["packages/gate-node/test/one3.test.mjs"], "^ONE-3:", { metric: (out) => (/^# ONE-3: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "ONE-4", m: "M9", kind: "+", level: 1, pair: "ONE-8", property: "way-in", title: "a stopped agent gets Ludion-Error and the help link; from help, npx ludion init reaches VERIFIED in ≤3 min",
    timeoutMs: 1_500_000, run: nodeTest(["site/test/one4.test.mjs"], "^ONE-4:", { timeoutMs: 1_480_000, metric: (out) => (/^# ONE-4: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "ONE-8", m: "M9", kind: "-", level: 1, property: "way-in", title: "a refusal that does not lead to VERIFIED fails ONE-4: no reason, no help link, a help page that does not exist or gives no steps, an arrival that is not VERIFIED (planted, against the built site)",
    timeoutMs: 900_000, run: nodeTest(["site/test/one4.test.mjs"], "^ONE-8:", { timeoutMs: 880_000, metric: (out) => (/^# ONE-8: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "ONE-5", m: "M9", kind: "±", level: 1, title: "a write by something claiming to be a crawler is reported as a suspected fake (fixed data, 0 misjudged)",
    run: nodeTest(["packages/report/test/one5.test.mjs"], "^ONE-5:", { metric: (out) => (/^# ONE-5: (.+)$/m.exec(out) ?? [])[1] }) },
  // MCP-1/2 run in their own CI job (`mcp`, Java and Keycloak), outside LOOP-2's 10 minutes (the human's
  // decision, 2026-10-03). Keycloak fetches the card from the production Card Host Worker (accept/mcp/).
  { id: "MCP-1", m: "M9", kind: "+", level: 1, job: "mcp", pair: "MCP-2", property: "mcp-client-id", title: "e2e with Keycloak (CIMD on) as the authorization server: the agent's client document (…/client, the card's origin and keys) as client_id is authorized",
    timeoutMs: 600_000, run: nodeTest(["accept/mcp/mcp.test.mjs"], "^MCP-1:", { timeoutMs: 580_000, metric: (out) => (/^# MCP-1: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "MCP-2", m: "M9", kind: "-", level: 1, job: "mcp", property: "mcp-client-id", title: "Keycloak gives no token to what is not the card's: the Root key, a stranger's key, another audience, a used assertion, an unlisted redirect, a revoked agent — each refused at its own step",
    timeoutMs: 600_000, run: nodeTest(["accept/mcp/mcp.test.mjs"], "^MCP-2:", { timeoutMs: 580_000 }) },
  // The token endpoint is where the agent proves it holds the key (its client_id is public): an exchange
  // with no signature by a key in its directory gets no token. Bites: a client document that says
  // "none" on a server that allows public clients is caught.
  { id: "MCP-3", m: "M9", kind: "-", level: 1, job: "mcp", property: "mcp-client-id", title: "no key, no token: Keycloak refuses an exchange with no signature by the agent's key — no client authentication (PKCE only), alg none, a cut-off signature, a client secret; the signed control gets its token",
    timeoutMs: 600_000, run: nodeTest(["accept/mcp/mcp.test.mjs"], "^MCP-3:", { timeoutMs: 580_000, metric: (out) => (/^# MCP-3: (.+)$/m.exec(out) ?? [])[1] }) },
  // After MCP-3: the protection rests on the document saying private_key_jwt, so the Card Host serves no
  // card and no client document that says anything else (the human's decision, 2026-10-04).
  { id: "MCP-4", m: "M9", kind: "±", level: 0, property: "mcp-client-id", title: "the Card Host serves no card and no client document whose token_endpoint_auth_method is not private_key_jwt: agents registered asking for none or a secret still get private_key_jwt; 13 planted values refused on both paths",
    run: nodeTest(["packages/card-host/test/mcp4.test.mjs"], "^MCP-4", { metric: (out) => (/^# MCP-4: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "PUR-1", m: "M9", kind: "-", level: 0, title: "a purpose not covered by the signature is an unsigned claim and is never used for matching",
    run: nodeTest(["packages/gate-core/test/pur.test.mjs"], "^PUR-1:", { metric: (out) => (/^# PUR-1: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "PUR-2", m: "M9", kind: "-", level: 1, title: "the purpose note never leaves the Gate (PRIV-1's canaries)",
    run: nodeTest(["packages/gate-node/test/pur2.test.mjs"], "^PUR-2:", { metric: (out) => (/^# PUR-2: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "PUR-3", m: "M9", kind: "±", level: 0, title: "a write after declaring read (or claiming to be a crawler) is a contradiction",
    run: nodeTest(["packages/gate-core/test/pur.test.mjs"], "^PUR-3:", { metric: (out) => (/^# PUR-3: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "PUR-4", m: "M9", kind: "+", level: 1, pair: "PUR-7", property: "purpose-retry", title: "a diver that gets purpose_required retries with a purpose on its own",
    run: nodeTest(["packages/gate-node/test/pur4.test.mjs"], "^PUR-4:", { metric: (out) => (/^# PUR-4: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "PUR-5", m: "M9", kind: "-", level: 0, title: "the note is shown escaped, and URLs in it are not links",
    run: nodeTest(["packages/report/test/pur5.test.mjs"], "^PUR-5:", { metric: (out) => (/^# PUR-5: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "PUR-6", m: "M9", kind: "-", level: 0, title: "the diver does not send a note holding an email address, a phone number, a URL or a long number",
    run: nodeTest(["packages/diver/test/pur6.test.mjs"], "^PUR-6:", { metric: (out) => (/^# PUR-6: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "PUR-7", m: "M9", kind: "-", level: 1, property: "purpose-retry", title: "the diver's resend never loops: a request that said a purpose is not sent again, nor a body that cannot be sent twice; a read is not asked for a purpose",
    run: nodeTest(["packages/gate-node/test/pur4.test.mjs"], "^PUR-7:") },
  { id: "BLK-1", m: "M9", kind: "±", level: 1, title: "a block takes effect with one config line and undoes with one; Ludion's servers have no path to block",
    run: nodeTest(["packages/gate-node/test/blk1.test.mjs"], "^BLK-1:", { metric: (out) => [...out.matchAll(/^# BLK-1: (.+)$/gm)].map((m) => m[1]).join("; ") || undefined }) },

  // M10 — the three questions (lane 2's spec, docs/lanes/lane2-spec.md §4): who is this AI, what may it
  // do (the Mandate's scope, held by the site's Gate), how is it stopped (revocation). v0's Mandate is an
  // operator's own limit on its agent (prn "self"). Added PENDING on 2026-10-05.
  { id: "MND-1", m: "M10", kind: "±", level: 0, title: "a Mandate is issued only on a Root-signed request; one signed by a session key is refused; the SDK never loads the Root at run time",
    run: nodeTest(["services/registry/test/mnd.test.mjs"], "^MND-1:", { metric: (out) => (/^# MND-1: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "MND-2", m: "M10", kind: "±", level: 1, title: "a correctly signed request outside its Mandate's scope gets 403 mandate_scope from the Gate; inside it passes; a mutation that drops the check is caught",
    run: nodeTest(["services/registry/test/mnd.test.mjs"], "^MND-2:", { metric: (out) => [...out.matchAll(/^# MND-2: (.+)$/gm)].map((m) => m[1]).join("; ") || undefined }) },
  { id: "MND-3", m: "M10", kind: "-", level: 1, title: "a Mandate for another site, another Diver, expired or revoked is no Mandate (403 mandate_required)",
    run: nodeTest(["services/registry/test/mnd.test.mjs"], "^MND-3:", { metric: (out) => (/^# MND-3: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "MND-4", m: "M10", kind: "±", level: 1, title: "per_day holds only at a Gate with a place to count it; a Gate without one refuses a Mandate with per_day",
    run: nodeTest(["services/registry/test/mnd.test.mjs"], "^MND-4:", { metric: (out) => (/^# MND-4: (.+)$/m.exec(out) ?? [])[1] }) },
  { id: "MND-5", m: "M10", kind: "±", level: 0, title: "(optional) with a Mandate attached, the SDK does not sign a request outside its scope",
    run: nodeTest(["packages/diver/test/mnd5.test.mjs"], "^MND-5", { metric: (out) => [...out.matchAll(/^# MND-5(?: planted)?: (.+)$/gm)].map((m) => m[1]).join("; ") || undefined }) },
  { id: "DEMO-1", m: "M10", kind: "±", level: 1, title: "lane 2 spec §3.4's flow passes in CI with a scripted hijack: in-scope browsing and cart pass; the trap page's password change and delete get 403 mandate_scope, also signed directly with the stolen session key; re-issuing the Mandate without the Root is refused; revoke makes everything REVOKED",
    timeoutMs: 600_000, run: nodeTest(["examples/demo-shop/demo1.test.mjs"], "^DEMO-1", { timeoutMs: 580_000, metric: (out) => [...out.matchAll(/^# DEMO-1(?: planted| model)?: (.+)$/gm)].map((m) => m[1]).join("; ") || undefined }) },
  { id: "CEN-1", m: "M10", kind: "±", level: 1, title: "every census value has a source and the date it was checked; no forbidden evaluative words; the page builds" },
  { id: "CEN-2", m: "M10", kind: "±", level: 1, title: "the census has a method section and a corrections contact; the data and the table's rows match" },
  { id: "MSG-1", m: "M10", kind: "±", level: 0, title: "the README's opening, the top page, show-hn.md and faq.md carry the three questions and 'what Ludion does not prevent'; no overclaims (unhackable, bulletproof, prevents breaches, 100% secure, 絶対に, 完全に防ぐ …)",
    run: nodeTest(["accept/msg/msg1.test.mjs"], "^MSG-1", { metric: (out) => [...out.matchAll(/^# MSG-1(?: planted)?: (.+)$/gm)].map((m) => m[1]).join("; ") || undefined }) },
];
