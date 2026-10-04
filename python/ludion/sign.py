"""Request signing (spec §10.4, draft-ietf-webbotauth-httpsig-protocol-00 §5.2), the same profile
as the JS Diver:

  always:                  @authority, "signature-agent";key=<label>
  POST/PUT/PATCH/DELETE:   @method, @path, content-digest (RFC 9530)
  when present:            ludion-staple, ludion-mandate
  params:                  created, expires (<= 60 s), keyid, alg="ed25519", nonce (64 bytes), tag="web-bot-auth"

The signature base and header serialisation are http-message-signatures'. Its component
resolver is replaced by `_ConformantResolver`, which fixes three RFC 9421 bugs of version 2.0.1
(dictionary `key`, default port in @authority, empty @path); STD-3 reproduces each and the
upstream reports are drafted in docs/outbox/2026-09-30-pyhms-*.md.
"""

import base64
import datetime
import hashlib
import urllib.parse

from http_message_signatures import HTTPMessageSigner, HTTPSignatureKeyResolver, algorithms, http_sfv
from http_message_signatures.exceptions import HTTPMessageSignaturesException
from http_message_signatures.resolvers import HTTPSignatureComponentResolver
from http_message_signatures.structures import CaseInsensitiveDict

from . import _crypto
from .keys import unb64u

STATE_CHANGING = {"POST", "PUT", "PATCH", "DELETE"}
DEFAULT_LIFETIME_S = 60
TAG = "web-bot-auth"
_DEFAULT_PORTS = {"http": 80, "https": 443}


class _ConformantResolver(HTTPSignatureComponentResolver):
    def resolve(self, component_node):
        component_id = str(component_node.value)
        params = dict(component_node.params)
        if component_id.startswith("@") or not params:
            return super().resolve(component_node)
        if set(params) != {"key"}:
            raise HTTPMessageSignaturesException(f"unsupported component parameters {sorted(params)}")
        dictionary = http_sfv.Dictionary()
        dictionary.parse(self.headers[component_id].encode())
        return str(dictionary[params["key"]])

    def get_authority(self):
        u = urllib.parse.urlsplit(self.url)
        host = u.hostname or ""
        if ":" in host:
            host = f"[{host}]"
        return host if u.port is None or u.port == _DEFAULT_PORTS.get(u.scheme.lower()) else f"{host}:{u.port}"

    def get_path(self):
        return urllib.parse.urlsplit(self.url).path or "/"


class _SessionKey(HTTPSignatureKeyResolver):
    def __init__(self, kid: str, seed: bytes):
        self._kid, self._seed = kid, seed

    def resolve_private_key(self, key_id: str):
        if key_id != self._kid:
            raise HTTPMessageSignaturesException("unknown keyid")
        return _crypto.signing_key(self._seed)

    def resolve_public_key(self, key_id: str):
        raise HTTPMessageSignaturesException("a Diver signs; it does not verify")


class _Message:
    def __init__(self, method, url, headers):
        self.method, self.url, self.headers = method, url, CaseInsensitiveDict(headers)


def _nonce() -> str:
    return base64.b64encode(_crypto.random_bytes(64)).decode("ascii")


class Signer:
    """Signs requests with a SESSION key for the agent published at `signature_agent`."""

    def __init__(self, session_jwk: dict, signature_agent: str, *, label: str = "sig1", cimd: bool = False,
                 lifetime_s: int = DEFAULT_LIFETIME_S, staple=None, mandate=None, now=None):
        agent = urllib.parse.urlsplit(signature_agent)
        if agent.scheme != "https":
            raise ValueError("signature_agent must be https")
        if lifetime_s > 60:
            raise ValueError("expires - created must be at most 60 seconds")
        self.keyid = session_jwk["kid"]
        self._seed = unb64u(session_jwk["d"])
        self._origin = f"https://{agent.netloc}"
        self.label, self.cimd, self.lifetime_s = label, cimd, lifetime_s
        self._staple, self._mandate = staple, mandate
        self._now = now or (lambda: datetime.datetime.now(tz=datetime.timezone.utc))
        self._hms = HTTPMessageSigner(signature_algorithm=algorithms.ED25519, key_resolver=_SessionKey(self.keyid, self._seed),
                                      component_resolver_class=_ConformantResolver)

    def headers_for(self, method: str, url: str, headers=None, body=None) -> dict:
        """The headers to add to a request (Signature-Agent, Content-Digest, Signature-Input, Signature)."""
        method = method.upper()
        out = dict(headers or {})
        out["Signature-Agent"] = f'{self.label}="{self._origin}/card";type=cimd' if self.cimd else f'{self.label}="{self._origin}"'
        components = ["@authority", f'"signature-agent";key="{self.label}"']
        if method in STATE_CHANGING:
            components += ["@method", "@path"]
            if body is not None:
                data = body.encode() if isinstance(body, str) else bytes(body)
                out["Content-Digest"] = "sha-256=:" + base64.b64encode(hashlib.sha256(data).digest()).decode() + ":"
                components.append("content-digest")
        for name, source in (("Ludion-Staple", self._staple), ("Ludion-Mandate", self._mandate)):
            value = source() if callable(source) else source
            if value:
                out[name] = value
                components.append(name.lower())
        msg = _Message(method, url, out)
        created = self._now()
        self._hms.sign(msg, key_id=self.keyid, created=created, expires=created + datetime.timedelta(seconds=self.lifetime_s),
                       nonce=_nonce(), label=self.label, tag=TAG, covered_component_ids=components)
        return dict(msg.headers.items())
