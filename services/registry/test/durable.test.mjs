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

test("registry: REG-7's counters on the Durable Object store read only their own key; the expired are swept at most once a minute, in batches of 128", async () => {
  const { createDurableStore, memoryStorage } = await import("../src/durable.mjs");
  // The Durable Object storage API, counting listings, and refusing a batch over 128 keys (the
  // key-value API's batch limit; a counter sweep must never depend on a platform allowing more).
  const inner = memoryStorage();
  let lists = 0;
  const storage = {
    ...inner,
    get: (k) => inner.get(k), put: (k, v) => inner.put(k, v),
    async list(o) { if (o?.prefix === "hit:") lists++; return inner.list(o); },
    async delete(k) { if (Array.isArray(k) && k.length > 128) throw new Error(`delete of ${k.length} keys (max 128)`); return inner.delete(k); },
  };
  const store = await createDurableStore(storage);
  const t0 = 2_000_000_000;
  // A burst: 300 different keys in one window, then a quiet hour.
  for (let i = 0; i < 300; i++) assert.equal((await store.hit(`ip:${i}`, 3600, t0 + Math.floor(i / 10))).n, 1);
  assert.ok(lists <= 1, `a burst of 300 counts listed every counter ${lists} times (once a minute at most)`);
  assert.equal((await store.hit("ip:0", 3600, t0 + 30)).n, 2, "a live counter counts on");
  // After the window: the next count starts at 1 (an expired counter is gone, swept or not) and the sweep of 300 stale keys does not throw.
  const later = t0 + 3600 + 120;
  assert.deepEqual(await store.hit("ip:7", 3600, later), { n: 1, until: later + 3600 });
  const left = [...(await inner.list({ prefix: "hit:" })).keys()];
  assert.deepEqual(left, ["hit:ip:7"], `the expired counters were swept: ${left.length} left`);
  // Inside a minute of a sweep, counting never lists.
  const before = lists;
  for (let i = 0; i < 50; i++) await store.hit(`contact:${i}`, 86_400, later + 1 + i);
  assert.equal(lists, before, "counts within a minute of a sweep list nothing");
});
