# DRAFT — upstream issue for pyauth/http-message-signatures

Status: draft, not filed. Filing is a human action (CLAUDE.md, "対外"). Found by STD-3
(`interop/std3.test.mjs`, test "upstream pyauth#3"), which keeps reproducing it while
`http-message-signatures==2.0.1` is pinned.

---

**Title:** `@path` of a URL with an empty path is `""` instead of `/` (RFC 9421 §2.2.6)

**Version:** http-message-signatures 2.0.1

**What happens**

`get_path()` returns `urlsplit(url).path`, which is `""` for `https://shop.example`. RFC 9421
§2.2.6: "An empty path string is normalized as a single slash (`/`) character." Other
implementations (and the request line a client actually sends, `GET / HTTP/1.1`) use `/`, so a
signature covering `@path` of such a request does not verify across implementations.

`get_request_target()` inherits the same problem.

**Minimal repro**

```python
from http_message_signatures.resolvers import HTTPSignatureComponentResolver
class Msg: method = "POST"; url = "https://shop.example"; headers = {}
print(repr(HTTPSignatureComponentResolver(Msg()).get_path()))
```

Actual: `''` — Expected: `'/'`

**Suggested fix**

`return urllib.parse.urlsplit(self.url).path or "/"`.
