"""DIV-1, the Python agent side. Runs inside a clean python:3.12 container (CI) or, as the
documented fallback, in a fresh temp dir. It uses only what an agent developer would: a fresh
virtualenv, the hash-pinned dependencies, the locally built `ludion` wheel (not published),
`python -m ludion init`, and `DiverAuth` — nothing from the monorepo.

    python agent-py.py --gate http://127.0.0.1:PORT --pkgs DIR --lock FILE      (cwd: an empty work dir)

Phase 1 (any Python >= 3.11) builds ./venv and installs; phase 2 re-runs this file inside it.
Prints one JSON line: {"ok", "steps": {install, init, publish, first_verified}, "responses", "store"}.
"""

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.request

p = argparse.ArgumentParser()
p.add_argument("--gate", required=True)
p.add_argument("--pkgs", required=True)
p.add_argument("--lock", required=True)
p.add_argument("--phase", default="1")
p.add_argument("--t0", type=float)
p.add_argument("--install", type=float)
a = p.parse_args()
cwd = pathlib.Path.cwd()


def fail(why, **extra):
    print(json.dumps({"ok": False, "why": why, **extra}))
    sys.exit(1)


def run(cmd, **kw):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        fail(f"{' '.join(map(str, cmd))} exited {r.returncode}", stderr=r.stderr[-1500:], stdout=r.stdout[-500:])
    return r.stdout


if a.phase == "1":
    t0 = time.perf_counter()
    venv = cwd / "venv"
    run([sys.executable, "-m", "venv", str(venv)])
    vpy = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    pip = [str(vpy), "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--no-cache-dir"]
    run(pip + ["--require-hashes", "--no-deps", "--only-binary", ":all:", "-r", a.lock])
    wheels = sorted(str(w) for w in pathlib.Path(a.pkgs).glob("ludion-*.whl"))
    if not wheels:
        fail(f"no ludion wheel in {a.pkgs}")
    run(pip + ["--no-deps", "--no-index", *wheels])
    install = time.perf_counter() - t0
    r = subprocess.run([str(vpy), __file__, "--gate", a.gate, "--pkgs", a.pkgs, "--lock", a.lock, "--phase", "2",
                        "--t0", str(t0), "--install", str(install)], cwd=cwd)
    sys.exit(r.returncode)

# ── phase 2, inside the fresh venv ──────────────────────────────────────────────────────
steps = {"install": round(a.install, 3)}
t = time.perf_counter()
run([sys.executable, "-m", "ludion", "init", "--name", "DIV-1 Python Agent", "--contact", "mailto:ops@div1.example"])
steps["init"] = round(time.perf_counter() - t, 3)

t = time.perf_counter()
(cwd / "published" / ".well-known").mkdir(parents=True, exist_ok=True)
shutil.copyfile(cwd / "card", cwd / "published" / "card")
shutil.copyfile(cwd / ".well-known" / "http-message-signatures-directory", cwd / "published" / ".well-known" / "http-message-signatures-directory")
steps["publish"] = round(time.perf_counter() - t, 3)

t = time.perf_counter()
from ludion import Diver, DiverAuth  # noqa: E402  (installed from the wheel just now)

auth = DiverAuth(Diver.load("ludion.json", cimd=True))
responses = []
for method, path, body in (("GET", "/products?q=camera", None), ("POST", "/checkout/1", b'{"sku":"cam-1","qty":1}')):
    req = auth(urllib.request.Request(a.gate + path, data=body, method=method, headers={"content-type": "application/json"} if body else {}))
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            responses.append({"method": method, "status": res.status, "body": json.loads(res.read())})
    except urllib.error.HTTPError as e:
        responses.append({"method": method, "status": e.code, "body": json.loads(e.read() or b"{}")})
steps["first_verified"] = round(time.perf_counter() - t, 3)
steps["total"] = round(time.perf_counter() - a.t0, 3)
store = json.loads((cwd / "ludion.json").read_text())
print(json.dumps({"ok": True, "steps": steps, "responses": responses, "store": {"diver_id": store["diver_id"], "signature_agent": store["signature_agent"]}}))
