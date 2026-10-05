# ludion (Python)

The Ludion Diver for Python: a Web Bot Auth (RFC 9421) identity for an agent, and signed requests.

**Planned, after the launch.** It is not published to PyPI and not part of the launch, so this page gives
no install steps. The code here is tested in CI (DIV-1: `init` to VERIFIED in a clean environment, and
byte-compatibility with the JavaScript CLI), and `ludion.json`, the sealed Root keystore, the directory
and the card it writes are the same as `npx ludion-ai` writes.

**Security**

- **The Root key never signs requests.** Only the Session key does.
- **Plaintext Root is development-only.** `--dev` (or `LUDION_DEV=1`) stores the Root in plaintext, and every load warns on stderr.
- **Crypto sources.** Every primitive comes from `cryptography` (OpenSSL) in `ludion/_crypto.py`. The signature base comes from `http-message-signatures`, with three RFC 9421 conformance fixes (see `ludion/sign.py`).
