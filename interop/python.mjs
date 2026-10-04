// A pinned Python for the oracles that need one (STD-3's non-JS implementation, DIV-1's Python
// Diver). Finds a CPython >= 3.11, then builds a virtualenv in the OS temp dir from a hashed
// lock (`pip install --require-hashes --no-deps --only-binary :all:`), cached by the lock's
// content and the interpreter version. No Python is a FAIL for the oracle, never a skip.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

const MIN = [3, 11];
const CANDIDATES = process.platform === "win32" ? [["python"], ["py", "-3"], ["python3"]] : [["python3"], ["python"]];

/** The first interpreter that is CPython >= 3.11: { cmd, args, version }. Throws with what was tried. */
export function findPython() {
  const tried = [];
  for (const [cmd, ...pre] of CANDIDATES) {
    try {
      const out = execFileSync(cmd, [...pre, "-c", "import sys, platform; print(platform.python_implementation(), *sys.version_info[:3])"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000 }).trim();
      const [impl, ...v] = out.split(/\s+/);
      const version = v.map(Number);
      if (impl === "CPython" && (version[0] > MIN[0] || (version[0] === MIN[0] && version[1] >= MIN[1]))) return { cmd, args: pre, version: version.join(".") };
      tried.push(`${[cmd, ...pre].join(" ")}: ${out}`);
    } catch (e) { tried.push(`${[cmd, ...pre].join(" ")}: ${e.code ?? "failed"}`); }
  }
  throw new Error(`no CPython >= ${MIN.join(".")} found (tried ${tried.join("; ")})`);
}

const venvPython = (dir) => (process.platform === "win32" ? path.join(dir, "Scripts", "python.exe") : path.join(dir, "bin", "python"));

/**
 * A virtualenv with exactly the locked packages. Returns the venv's python path.
 * @param {string} lockFile  a requirements file with --hash for every package
 * @param {{ extra?: string[] }} [opts]  extra local wheels installed with --no-deps (their deps must be in the lock)
 */
export function ensureVenv(lockFile, { extra = [] } = {}) {
  const py = findPython();
  const h = createHash("sha256").update(fs.readFileSync(lockFile)).update(py.version).update(process.platform);
  for (const w of extra) h.update(fs.readFileSync(w));
  const dir = path.join(os.tmpdir(), `ludion-pyvenv-${h.digest("hex").slice(0, 16)}`);
  const ok = path.join(dir, ".ludion-ready");
  if (fs.existsSync(ok)) return venvPython(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
  run(py.cmd, [...py.args, "-m", "venv", dir]);
  const vpy = venvPython(dir);
  run(vpy, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--require-hashes", "--no-deps", "--only-binary", ":all:", "-r", lockFile]);
  if (extra.length) run(vpy, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--no-deps", "--no-index", ...extra]);
  fs.writeFileSync(ok, new Date().toISOString());
  return vpy;
}

/** Run a Python script with a JSON document on stdin; resolves with the parsed JSON on stdout. */
export function runJson(python, script, input, { timeoutMs = 120_000, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", ...env } });
    const out = [], err = [];
    const t = setTimeout(() => { p.kill(); reject(new Error(`${path.basename(script)} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", (c) => err.push(c));
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => {
      clearTimeout(t);
      const text = Buffer.concat(out).toString("utf8");
      if (code !== 0) return reject(new Error(`${path.basename(script)} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-800)}`));
      try { resolve(JSON.parse(text)); } catch { reject(new Error(`${path.basename(script)} printed no JSON: ${text.slice(0, 300)}`)); }
    });
    p.stdin.end(JSON.stringify(input));
  });
}
