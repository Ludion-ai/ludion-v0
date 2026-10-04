// SEC-1 (±): no secret in the repository — not in any commit of its history, not in the working tree
// (spec v2.0.1 §20.2, ADR-042). gitleaks, pinned by version and SHA-256, with its default rules and
// .gitleaks.toml's narrow exceptions for generated test data. REG-4 still owns private keys.
//
// The other side: the same scan finds secrets planted in a throwaway repository — in a file, in a
// commit that a later commit deleted, and inside the very files the exceptions cover (a kind of secret
// the exception does not name) — so the exceptions cannot hide what they were not written for.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gitleaks, scan, GITLEAKS_VERSION } from "./gitleaks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = path.join(ROOT, ".gitleaks.toml");
let bin;
before(async () => { bin = await gitleaks(); }, { timeout: 300_000 });

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" } });

// Shaped like real credentials, made up for this test, assembled at run time so this file holds none.
const j = (...p) => p.join("");
const PLANTED = {
  aws: j("AKIA", "Q3EGBP7Z", "LUDION2X"),
  github: j("ghp_", "R8fT2kLm9Qw4Xz7Vb1Nc6Hj3Sd5Gy0Ua", "Pe2K"),
  slack: j("https://hooks.slack.com/services/", "T0LUDION1/B0LUDION2/", "kQ8x7Vb2Nc4Hj6Sd9Gy1Ua3P"),
  stripe: j("sk_live_", "51LudionTestQ8x7Vb2Nc4Hj6Sd9Gy1Ua3PeR5tY7"),
};

test("SEC-1: the scan finds planted secrets — in a file, in a deleted commit, and inside the files the exceptions cover", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-sec1-"));
  try {
    git(repo, "init", "-q");
    fs.mkdirSync(path.join(repo, "src"));
    fs.writeFileSync(path.join(repo, "src", "deploy.mjs"), `const AWS_ACCESS_KEY_ID = "${PLANTED.aws}";\nconst token = "${PLANTED.github}";\n`);
    git(repo, "add", "-A"); git(repo, "commit", "-qm", "add deploy");
    fs.rmSync(path.join(repo, "src", "deploy.mjs"));
    git(repo, "add", "-A"); git(repo, "commit", "-qm", "remove it again");
    // The excepted files, holding a kind of secret their exception does not name.
    fs.mkdirSync(path.join(repo, "accept", "conformance"), { recursive: true });
    fs.mkdirSync(path.join(repo, "accept", "fixtures", "report", "truth"), { recursive: true });
    fs.writeFileSync(path.join(repo, "accept", "conformance", "vectors.json"), JSON.stringify({ notify: PLANTED.slack }) + "\n");
    fs.writeFileSync(path.join(repo, "accept", "fixtures", "report", "truth", "a.truth.json"), JSON.stringify({ stripe: PLANTED.stripe }) + "\n");
    git(repo, "add", "-A"); git(repo, "commit", "-qm", "fixtures");
    const history = scan(bin, "git", repo, { config: CONFIG });
    const rules = (fs_) => [...new Set(fs_.map((f) => `${f.RuleID} ${f.File.split(path.sep).join("/")}`))].sort();
    const found = rules(history);
    for (const want of ["aws-access-token src/deploy.mjs", "github-pat src/deploy.mjs", "slack-webhook-url accept/conformance/vectors.json", "stripe-access-token accept/fixtures/report/truth/a.truth.json"]) {
      assert.ok(found.includes(want), `not found: ${want} (found: ${found.join(", ")})`);
    }
    assert.ok(history.every((f) => !JSON.stringify(f).includes(PLANTED.aws)), "the report itself redacts what it found");
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test("SEC-1: no secret in any commit of this repository's history", () => {
  const found = scan(bin, "git", ROOT, { config: CONFIG });
  assert.deepEqual(found.map((f) => `${f.RuleID} ${f.File}:${f.StartLine} ${f.Commit?.slice(0, 7)}`), []);
  const commits = Number(git(ROOT, "rev-list", "--count", "HEAD").trim());
  console.log(`SEC-1: gitleaks ${GITLEAKS_VERSION}, ${commits} commits and the working tree: 0 secrets`);
});

test("SEC-1: no secret in the working tree, committed or not (ignored files aside)", () => {
  const files = git(ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0").filter(Boolean);
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "ludion-sec1-tree-"));
  try {
    for (const f of files) {
      const from = path.join(ROOT, f);
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
      fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
      fs.copyFileSync(from, path.join(copy, f));
    }
    const found = scan(bin, "dir", copy, { config: CONFIG });
    assert.deepEqual(found.map((f) => `${f.RuleID} ${f.File}:${f.StartLine}`), []);
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
});
