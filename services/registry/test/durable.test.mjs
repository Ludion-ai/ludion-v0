// The Registry on a Durable Object's store (ADR-041): the Registry's own tests, run again with the
// store the production Worker uses (createDurableStore over a Durable Object's storage API).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("registry: its tests pass on the Durable Object store too (registration, keys, Staples, revocation and its stream, PRIV-3)", () => {
  const files = ["registry.test.mjs", "reg3.test.mjs", "priv3.test.mjs"].map((f) => path.join(HERE, f));
  // Not as a child of this test run: its own runner, reporting TAP on stdout.
  const env = { ...process.env, LUDION_REGISTRY_STORE: "durable" };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], { encoding: "utf8", timeout: 300_000, env });
  const n = (k) => Number((new RegExp(`^# ${k} ([0-9]+)`, "m").exec(r.stdout) ?? [])[1] ?? 0);
  assert.ok(n("pass") >= 9, `only ${n("pass")} tests ran:\n${r.stdout.slice(-2000)}`);
  assert.equal(n("fail"), 0, r.stdout.slice(-3000));
});
