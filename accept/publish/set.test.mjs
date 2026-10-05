// npm pack --json changed shape in npm 12 (an object keyed by package name; npm ≤ 11 printed an array).
// Found 2026-10-05 when this machine's npm became 12.2.0 and every oracle that packs broke (ONE-4, ONE-8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { packEntry, packList } from "./set.mjs";

test("packEntry: npm 11's array and npm 12's object give the same entry; anything else is an error", () => {
  const e = { name: "ludion", version: "0.0.1", filename: "ludion-0.0.1.tgz", files: [] };
  assert.deepEqual(packEntry([e]), e, "npm ≤ 11");
  assert.deepEqual(packEntry({ ludion: e }), e, "npm 12");
  for (const bad of [[], {}, null, "x", [{}], { ludion: {} }]) assert.throws(() => packEntry(bad), /printed no package/);
});

test("packList: the real npm on this machine, whatever its version, lists the ludion package", () => {
  const l = packList("ludion");
  assert.equal(l.name, "ludion");
  assert.ok(l.files.includes("package.json"));
});
