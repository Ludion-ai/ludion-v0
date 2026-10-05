"""A Diver identity on disk (`ludion.json`, the same file the JS CLI writes) and the one-line auth.

    import httpx
    from ludion import DiverAuth

    client = httpx.Client(auth=DiverAuth.from_env())
    r = client.get("https://shop.example/api/products", params={"q": "camera"})

`DiverAuth` is a plain callable `auth(request) -> request`, which is what both httpx and
requests accept as `auth=`, so neither is a dependency.
"""

import datetime
import json
import os
import pathlib
import sys

from . import keys
from .sign import Signer

DEV_BANNER = (
    "LUDION DEV MODE: the Root private key is stored in PLAINTEXT in ludion.json. "
    "Whoever reads that file owns this identity. Development only."
)


def _write_private(path: pathlib.Path, text: str):
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def init(directory=".", *, name="Unnamed agent", contact=None, domain=None,
         passphrase=None, dev=False, force=False) -> dict:
    """Create a Diver: a Root (sealed unless dev) and a Session key, the key directory and the Card.
    Writes ludion.json, .well-known/http-message-signatures-directory and card into `directory`.
    Nothing is written when the Root cannot be protected."""
    base = pathlib.Path(directory)
    store_file = base / "ludion.json"
    if store_file.exists() and not force:
        raise FileExistsError("ludion.json already exists (force=True creates a NEW identity)")
    if not dev:
        if not passphrase:
            raise ValueError(f"the Root key must be protected: set LUDION_ROOT_PASSPHRASE (at least {keys.MIN_PASSPHRASE_LENGTH} "
                             "characters) or pass dev=True for a throwaway development identity. Nothing was written.")
        if len(passphrase) < keys.MIN_PASSPHRASE_LENGTH:
            raise ValueError(f"the Root passphrase must be at least {keys.MIN_PASSPHRASE_LENGTH} characters. Nothing was written.")
    root, session = keys.generate_key(), keys.generate_key()
    did = keys.diver_id(root["x"])
    origin = f"https://{domain or did + '.agents.ludion.ai'}"
    # No placeholder: one would be everyone's mailbox and meet the Registry's per-contact limit (REG-7).
    contacts = [contact] if contact else []
    store = {
        "v": 0, **({"dev": True} if dev else {}), "diver_id": did, "signature_agent": origin,
        "name": name, "contacts": contacts,
        "root": root if dev else keys.seal_root(root, passphrase),
        "session": session, "created": datetime.datetime.now(tz=datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    base.mkdir(parents=True, exist_ok=True)
    _write_private(store_file, json.dumps(store, indent=2))
    (base / ".well-known").mkdir(exist_ok=True)
    (base / ".well-known" / "http-message-signatures-directory").write_text(
        json.dumps(keys.directory_document([keys.public_jwk(session)]), indent=2), encoding="utf-8", newline="\n")
    card = keys.card_document(origin, name, contacts, did, keys.thumbprint(store["root"]["x"]))
    (base / "card").write_text(json.dumps(card, indent=2), encoding="utf-8", newline="\n")
    client = keys.client_document(origin, name, contacts)
    (base / "client").write_text(json.dumps(client, indent=2), encoding="utf-8", newline="\n")
    if dev:
        print(f"⚠ {DEV_BANNER}", file=sys.stderr)
    return store


class Diver:
    """A loaded identity. Signs with the Session key only; the Root is never opened to sign."""

    def __init__(self, store: dict, *, cimd: bool = False):
        self.store = store
        if store.get("dev"):
            print(f"⚠ {DEV_BANNER}", file=sys.stderr)
        elif not keys.is_sealed_root(store.get("root")):
            print("⚠ ludion.json holds the Root private key in plaintext; treat this identity as development-only.", file=sys.stderr)
        self.signer = Signer(store["session"], store["signature_agent"], cimd=cimd)

    @classmethod
    def load(cls, path="ludion.json", **kw) -> "Diver":
        return cls(json.loads(pathlib.Path(path).read_text(encoding="utf-8")), **kw)

    def headers_for(self, method, url, headers=None, body=None) -> dict:
        return self.signer.headers_for(method, url, headers, body)


class DiverAuth:
    """`auth=` for httpx and requests: signs each request with Web Bot Auth."""

    def __init__(self, diver: Diver):
        self.diver = diver

    @classmethod
    def from_env(cls, **kw) -> "DiverAuth":
        return cls(Diver.load(os.environ.get("LUDION_DIVER", "ludion.json"), **kw))

    def __call__(self, request):
        """Sign an httpx.Request, a requests.PreparedRequest or a urllib.request.Request in place."""
        url = getattr(request, "url", None) or request.full_url            # urllib has full_url
        method = getattr(request, "method", None) or request.get_method()
        body = None
        for attr in ("content", "body", "data"):                          # httpx, requests, urllib
            body = getattr(request, attr, None)
            if body is not None:
                break
        signed = self.diver.headers_for(method, str(url), {}, body or None)
        for name, value in signed.items():
            request.headers[name] = value
        return request
