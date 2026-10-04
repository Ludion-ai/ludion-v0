# DRAFT — upstream issue for pyauth/http-message-signatures

Status: draft, not filed. Filing is a human action (CLAUDE.md, "対外"). Found by STD-3
(`interop/std3.test.mjs`, test "upstream pyauth#1"), which keeps reproducing it while
`http-message-signatures==2.0.1` is pinned.

---

**Title:** `key` parameter on a covered header component is ignored (RFC 9421 §2.1.2), breaking Web Bot Auth

**Version:** http-message-signatures 2.0.1 (Python 3.13, cryptography 50.0.1)

**What happens**

RFC 9421 §2.1.2 says a component identifier with the `key` parameter selects one member of a
Dictionary structured field, and the component value is that member (value and parameters)
serialized on its own. `HTTPSignatureComponentResolver.resolve()` ignores the parameters of
non-derived components and returns the whole field value.

Web Bot Auth (draft-ietf-webbotauth-httpsig-protocol-00 §5.2) requires signers to cover
`"signature-agent";key="<label>"`, so every Web Bot Auth signature produced or verified by the
library differs from other implementations (Cloudflare `web-bot-auth`, and ours).

**Minimal repro**

```python
from http_message_signatures import HTTPMessageSigner, HTTPSignatureKeyResolver, algorithms
from http_message_signatures.structures import CaseInsensitiveDict
from cryptography.hazmat.primitives.asymmetric import ed25519

class Msg:
    method = "GET"
    url = "https://shop.example/products"
    headers = CaseInsensitiveDict({"Signature-Agent": 'sig1="https://agent.example"'})

key = ed25519.Ed25519PrivateKey.generate()
class Keys(HTTPSignatureKeyResolver):
    def resolve_private_key(self, key_id): return key

signer = HTTPMessageSigner(signature_algorithm=algorithms.ED25519, key_resolver=Keys())
base, _, _ = signer._build_signature_base(Msg(), covered_component_ids=signer._parse_covered_component_ids(['"signature-agent";key="sig1"']), signature_params={})
print(base.splitlines()[0])
```

Actual: `"signature-agent";key="sig1": sig1="https://agent.example"`

Expected (RFC 9421 §2.1.2): `"signature-agent";key="sig1": "https://agent.example"`

For a member with parameters (`sig1="https://agent.example/card";type=cimd`) the expected value
is `"https://agent.example/card";type=cimd`.

**Suggested fix**

In `resolve()`, when the component has a `key` parameter, parse the field with
`http_sfv.Dictionary`, fail if the member is absent, and return `str(dictionary[key])`.
Unknown parameters (`sf`, `bs`, `req`, `tr`) should raise rather than be ignored silently. We
use exactly this as a local shim (`ConformantResolver` in `interop/py/pyhms_driver.py`) and it
interoperates with Cloudflare's implementation in both directions.
