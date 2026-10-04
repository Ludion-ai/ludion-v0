"""STD-3 driver for an independent, non-JS RFC 9421 implementation.

Implementation under test: `http-message-signatures` (pyauth, Python) with `cryptography`
(OpenSSL) for Ed25519, pinned with hashes in requirements.lock. This driver only adapts data
shapes: it hands the library a message object and key objects, and reads back the headers it
produces or the verdict it reaches. The signature base, the Signature-Input / Signature
serialisation, covered-component parsing and the Ed25519 operations are the library's own.

One deliberate, documented exception: with `"patched": true` the library's component
resolver is replaced by `ConformantResolver`, which fixes three RFC 9421 conformance bugs of
http-message-signatures 2.0.1 and nothing else. Each is reproduced unpatched by the STD-3
suite and has an upstream report drafted in docs/outbox/:

  1. section 2.1.2  `key` on a header component is ignored: `"signature-agent";key="sig1"`, which
     Web Bot Auth requires, resolves to the whole field instead of the dictionary member.
     (2026-09-30-pyhms-dictionary-key.md)
  2. section 2.2.3  `@authority` keeps an explicit default port (`shop.example:443`).
     (2026-09-30-pyhms-authority-default-port.md)
  3. section 2.2.6  `@path` of a URL with an empty path is "" instead of "/".
     (2026-09-30-pyhms-empty-path.md)

The fixes use the library's own structured-field parser and serialiser.

Protocol: one JSON document on stdin, {"ops": [...]}, one on stdout, {"results": [...]}.
Each op is {"op": "sign" | "verify" | "version", ...}.
"""

import base64
import datetime
import json
import sys
import urllib.parse
from importlib import metadata

from cryptography.hazmat.primitives.asymmetric import ed25519

from http_message_signatures import (
    HTTPMessageSigner,
    HTTPMessageVerifier,
    HTTPSignatureKeyResolver,
    algorithms,
)
from http_message_signatures import http_sfv
from http_message_signatures.exceptions import HTTPMessageSignaturesException
from http_message_signatures.resolvers import HTTPSignatureComponentResolver
from http_message_signatures.structures import CaseInsensitiveDict

DEFAULT_PORTS = {"http": 80, "https": 443}


def b64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class Message:
    """The request shape the library reads: .method, .url, .headers."""

    def __init__(self, method: str, url: str, headers):
        self.method = method
        self.url = url
        self.headers = CaseInsensitiveDict()
        for name, value in headers:
            if name in self.headers:
                self.headers[name] = self.headers[name] + ", " + value
            else:
                self.headers[name] = value


class JWKResolver(HTTPSignatureKeyResolver):
    def __init__(self, keys):
        self.keys = keys  # keyid -> jwk

    def resolve_public_key(self, key_id: str):
        jwk = self.keys.get(key_id)
        if jwk is None:
            raise HTTPMessageSignaturesException(f"unknown keyid {key_id}")
        return ed25519.Ed25519PublicKey.from_public_bytes(b64u(jwk["x"]))

    def resolve_private_key(self, key_id: str):
        jwk = self.keys.get(key_id)
        if jwk is None or "d" not in jwk:
            raise HTTPMessageSignaturesException(f"no private key for {key_id}")
        return ed25519.Ed25519PrivateKey.from_private_bytes(b64u(jwk["d"]))


class ConformantResolver(HTTPSignatureComponentResolver):
    """The library's resolver with the three RFC 9421 fixes listed in the module docstring."""

    def resolve(self, component_node):
        component_id = str(component_node.value)
        params = dict(component_node.params)
        if component_id.startswith("@") or not params:
            return super().resolve(component_node)
        if set(params) != {"key"}:
            raise HTTPMessageSignaturesException(f"unsupported component parameters {sorted(params)}")
        if component_id not in self.headers:
            raise HTTPMessageSignaturesException(f'Covered header field "{component_id}" not found in the message')
        dictionary = http_sfv.Dictionary()
        dictionary.parse(self.headers[component_id].encode())
        member = params["key"]
        if member not in dictionary:
            raise HTTPMessageSignaturesException(f'Dictionary member "{member}" not found in "{component_id}"')
        return str(dictionary[member])

    def get_authority(self):
        u = urllib.parse.urlsplit(self.url)
        host = u.hostname or ""
        if ":" in host:
            host = f"[{host}]"
        port = u.port
        return host if port is None or port == DEFAULT_PORTS.get(u.scheme.lower()) else f"{host}:{port}"

    def get_path(self):
        return urllib.parse.urlsplit(self.url).path or "/"


def handler(cls, keys, patched):
    kwargs = {"signature_algorithm": algorithms.ED25519, "key_resolver": JWKResolver(keys)}
    if patched:
        kwargs["component_resolver_class"] = ConformantResolver
    return cls(**kwargs)


def ts(seconds: int) -> datetime.datetime:
    return datetime.datetime.fromtimestamp(seconds, tz=datetime.timezone.utc)


def do_sign(op):
    req = op["request"]
    msg = Message(req["method"], req["url"], req["headers"])
    signer = handler(HTTPMessageSigner, {op["keyid"]: op["jwk"]}, op.get("patched", False))
    signer.sign(
        msg,
        key_id=op["keyid"],
        created=ts(op["created"]),
        expires=ts(op["expires"]) if op.get("expires") is not None else None,
        nonce=op.get("nonce"),
        label=op.get("label", "sig1"),
        tag=op.get("tag"),
        covered_component_ids=op["components"],
    )
    return {"ok": True, "signature-input": msg.headers["Signature-Input"], "signature": msg.headers["Signature"]}


def do_verify(op):
    req = op["request"]
    msg = Message(req["method"], req["url"], req["headers"])
    verifier = handler(HTTPMessageVerifier, op["keys"], op.get("patched", False))
    try:
        results = verifier.verify(msg, expect_tag=op.get("tag", "web-bot-auth"))
    except Exception as e:  # the verdict is the result; the reason is reported, never swallowed
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    r = results[0]
    return {"ok": True, "label": r.label, "covered": list(r.covered_components.keys()), "params": {k: str(v) for k, v in r.parameters.items()}}


def do_version(_op):
    import http_message_signatures.http_sfv.item as sfv_item

    with open(sfv_item.__file__, encoding="utf-8") as f:
        imports_typing_extensions = "typing_extensions" in f.read()
    return {
        "ok": True,
        "python": sys.version.split()[0],
        "http-message-signatures": metadata.version("http-message-signatures"),
        "cryptography": metadata.version("cryptography"),
        "requires": metadata.requires("http-message-signatures") or [],
        "http_sfv_imports_typing_extensions": imports_typing_extensions,
    }


OPS = {"sign": do_sign, "verify": do_verify, "version": do_version}


def main():
    doc = json.load(sys.stdin)
    out = []
    for op in doc["ops"]:
        try:
            out.append(OPS[op["op"]](op))
        except Exception as e:
            out.append({"ok": False, "error": f"{type(e).__name__}: {e}"})
    json.dump({"results": out}, sys.stdout)


if __name__ == "__main__":
    main()
