# DRAFT — upstream issue for pyauth/http-message-signatures

Status: draft, not filed. Filing is a human action (CLAUDE.md, "対外"). Found by STD-3
(`interop/std3.test.mjs`, test "upstream pyauth#2"), which keeps reproducing it while
`http-message-signatures==2.0.1` is pinned.

---

**Title:** `@authority` keeps an explicit default port (RFC 9421 §2.2.3)

**Version:** http-message-signatures 2.0.1

**What happens**

`get_authority()` returns `urlsplit(url).netloc.lower()`. For `https://shop.example:443/x` that
is `shop.example:443`. RFC 9421 §2.2.3 requires the authority to be normalized per HTTP
(RFC 9110 §4.2.3), which omits a default port: the value must be `shop.example`. A verifier
that sees the same request (a client sends `Host: shop.example`) computes a different
signature base, and the signature fails. Conversely, a signature over `shop.example` fails in
this library if the message URL carries `:443`.

Any client stack that keeps an explicit `:443` in the prepared URL hits this.

**Minimal repro**

```python
from http_message_signatures.resolvers import HTTPSignatureComponentResolver
class Msg: method = "GET"; url = "https://shop.example:443/x"; headers = {}
print(HTTPSignatureComponentResolver(Msg()).get_authority())
```

Actual: `shop.example:443` — Expected: `shop.example` (and `shop.example:8443` for a non-default port).

**Suggested fix**

Build the value from `hostname` and `port`, omit the port when it is the scheme's default
(80 for http, 443 for https), and keep IPv6 brackets.
