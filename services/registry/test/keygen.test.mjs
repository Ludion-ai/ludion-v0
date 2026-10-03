// The Registry's v0 signing key is made outside the repository and never printed (ADR-041). The file is
// what `wrangler deploy --secrets-file` takes, and the Worker reads the key back from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/keygen.mjs", import.meta.url));
const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: "utf8" });

test("registry keygen: writes the secrets file (the private JWK) outside the repository, prints the kid alone, never overwrites", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-keygen-"));
  try {
    const file = path.join(dir, "nested", "registry-secrets.json");
    const r = run(file);
    assert.equal(r.status, 0, r.stderr);
    const secrets = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(secrets), ["REGISTRY_SIGNING_KEY"], "the Worker's one secret");
    const jwk = JSON.parse(secrets.REGISTRY_SIGNING_KEY);
    assert.deepEqual(Object.keys(jwk).sort(), ["crv", "d", "kid", "kty", "x"]);
    assert.deepEqual(JSON.parse(r.stdout), { kid: jwk.kid });
    assert.ok(!r.stdout.includes(jwk.d) && !r.stderr.includes(jwk.d), "the private key is never printed");
    const again = run(file);
    assert.equal(again.status, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), secrets, "unchanged");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("registry keygen: refuses a path inside the repository, and no path at all", () => {
  const inRepo = fileURLToPath(new URL("../never-a-key.json", import.meta.url));
  const r = run(inRepo);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /inside the repository/);
  assert.ok(!fs.existsSync(inRepo));
  assert.equal(run().status, 2);
});
