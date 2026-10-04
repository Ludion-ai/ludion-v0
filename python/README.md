# ludion (Python)

The Ludion Diver for Python: a Web Bot Auth (RFC 9421) identity for your agent, and one line to sign every request.

> Not published to PyPI yet. Build the wheel locally: `pip wheel --no-deps -w dist python/`.

```sh
export LUDION_ROOT_PASSPHRASE='a long passphrase you keep elsewhere'
python -m ludion init --name "My Agent" --contact mailto:ops@example.com
```

`init` writes three files:

- `ludion.json`: keep it private. The Root key is sealed with your passphrase, which is not stored.
- `.well-known/http-message-signatures-directory`: publish it at your Signature-Agent origin.
- `card`: publish it at `<origin>/card`.

```python
import httpx
from ludion import DiverAuth

client = httpx.Client(auth=DiverAuth.from_env())
r = client.get("https://shop.example/api/products", params={"q": "camera"})
```

`DiverAuth` works with `requests` too (`requests.get(url, auth=DiverAuth.from_env())`).

`ludion.json`, the sealed Root keystore, the directory and the Card are byte-compatible with the JS CLI (`npx ludion`). An identity made by one works with the other.

**Security**

- **The Root key never signs requests.** Only the Session key does.
- **Plaintext Root is development-only.** `--dev` (or `LUDION_DEV=1`) stores the Root in plaintext, and every load warns on stderr.
- **Crypto sources.** Every primitive comes from `cryptography` (OpenSSL) in `ludion/_crypto.py`. The signature base comes from `http-message-signatures`, with three RFC 9421 conformance fixes (see `ludion/sign.py`).
