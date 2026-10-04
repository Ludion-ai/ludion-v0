# DRAFT — upstream issue for pyauth/http-message-signatures

Status: draft, not filed. Filing is a human action (CLAUDE.md, "対外"). Found by STD-3
(`interop/std3.test.mjs`, test "upstream pyauth#4"), which keeps reproducing it while
`http-message-signatures==2.0.1` is pinned.

---

**Title:** `import http_message_signatures` fails without `typing_extensions`, which is not declared

**Version:** http-message-signatures 2.0.1, Python 3.12 / 3.13

**What happens**

The vendored `http_message_signatures/http_sfv/item.py` does
`from typing_extensions import SupportsIndex` unconditionally, but the package's metadata only
requires `cryptography>=36.0.2`. In an environment installed strictly from the declared
dependencies (e.g. `pip install --require-hashes --no-deps` from a lock, or a fresh venv where
nothing else pulled `typing_extensions` in), importing the package fails:

```
ModuleNotFoundError: No module named 'typing_extensions'
```

It usually goes unnoticed because something else installs `typing_extensions` transitively
(cryptography does on Python < 3.11, and many other packages do).

**Minimal repro**

```sh
python3.13 -m venv v && v/bin/pip install --no-deps http-message-signatures==2.0.1 cryptography cffi pycparser
v/bin/python -c "import http_message_signatures"
```

**Suggested fix**

Either declare `typing-extensions` in `dependencies`, or import `SupportsIndex` from `typing`
(available since Python 3.8; the package requires >= 3.10).
