"""Diver identity for Python: keys, diver_id, keystore, directory and Card (spec §10.2, §10.3, §12).

Byte-compatible with the JS CLI (`@ludion/diver`): the same `ludion.json`, the same sealed-Root
format (docs/adr/ADR-019), the same thumbprints and diver_id, the same directory and Card, so an
identity made by one opens in the other. Primitives live in `_crypto` only.
"""

import base64
import hashlib
import json

from . import _crypto

DIRECTORY_PATH = "/.well-known/http-message-signatures-directory"
DIRECTORY_MEDIA_TYPE = "application/http-message-signatures-directory+json"
MIN_PASSPHRASE_LENGTH = 12
SCRYPT = {"N": 2**17, "r": 8, "p": 1}  # ~128 MiB, the OWASP scrypt baseline (same as JS)
SCRYPT_LIMITS = {"N": 2**20, "r": 16, "p": 4}


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _canonical(x: str) -> bytes:
    # RFC 7638 for OKP: members crv, kty, x in lexicographic order, no whitespace.
    return json.dumps({"crv": "Ed25519", "kty": "OKP", "x": x}, separators=(",", ":")).encode()


def thumbprint(x: str) -> str:
    """RFC 7638 JWK thumbprint (SHA-256, base64url): the keyid of Web Bot Auth."""
    return b64u(hashlib.sha256(_canonical(x)).digest())


def diver_id(root_x: str) -> str:
    """"dvr-" + base32 of the first 80 bits of the Root thumbprint (spec §10.2)."""
    return "dvr-" + base64.b32encode(hashlib.sha256(_canonical(root_x)).digest()[:10]).decode().lower()


def generate_key() -> dict:
    """A new Ed25519 private JWK with kid = thumbprint."""
    seed = _crypto.generate_seed()
    x = b64u(_crypto.public_from_seed(seed))
    return {"kty": "OKP", "crv": "Ed25519", "x": x, "d": b64u(seed), "kid": thumbprint(x)}


def public_jwk(jwk: dict) -> dict:
    return {"kty": "OKP", "crv": "Ed25519", "x": jwk["x"], "kid": jwk.get("kid") or thumbprint(jwk["x"])}


def _root_aad(pub: dict) -> bytes:
    body = json.dumps({"crv": pub["crv"], "kid": pub["kid"], "kty": pub["kty"], "x": pub["x"]}, separators=(",", ":"))
    return ("ludion-root-v1\n" + body).encode()


def is_sealed_root(root) -> bool:
    return isinstance(root, dict) and "d" not in root and (root.get("sealed") or {}).get("v") == 1


def seal_root(private_jwk: dict, passphrase: str) -> dict:
    """Seal a Root private JWK under a passphrase (scrypt + AES-256-GCM, public key + kid as AAD)."""
    if not isinstance(passphrase, str) or len(passphrase) < MIN_PASSPHRASE_LENGTH:
        raise ValueError(f"the Root passphrase must be at least {MIN_PASSPHRASE_LENGTH} characters")
    seed = unb64u(private_jwk["d"])
    if len(seed) != 32 or b64u(_crypto.public_from_seed(seed)) != private_jwk["x"]:
        raise ValueError("Root private key does not match its public key")
    pub = {"kty": "OKP", "crv": "Ed25519", "x": private_jwk["x"], "kid": thumbprint(private_jwk["x"])}
    salt, iv = _crypto.random_bytes(16), _crypto.random_bytes(12)
    key = _crypto.scrypt(passphrase, salt, SCRYPT["N"], SCRYPT["r"], SCRYPT["p"])
    ct, tag = _crypto.aes256gcm_seal(key, iv, seed, _root_aad(pub))
    sealed = {"v": 1, "kdf": "scrypt", **SCRYPT, "salt": b64u(salt), "cipher": "aes-256-gcm", "iv": b64u(iv), "ct": b64u(ct), "tag": b64u(tag)}
    return {**pub, "sealed": sealed}


def open_root(root: dict, passphrase: str) -> dict:
    """Open a sealed Root. Raises on a wrong passphrase, tampering, or a key that is not this Root."""
    if not is_sealed_root(root):
        raise ValueError("Root is not sealed")
    s = root["sealed"]
    if s.get("kdf") != "scrypt" or s.get("cipher") != "aes-256-gcm":
        raise ValueError("unsupported keystore")
    for k in ("N", "r", "p"):
        if not isinstance(s.get(k), int) or not 1 <= s[k] <= SCRYPT_LIMITS[k]:
            raise ValueError("keystore parameters out of range")
    if root.get("kty") != "OKP" or root.get("crv") != "Ed25519" or thumbprint(root["x"]) != root.get("kid"):
        raise ValueError("keystore public key and kid disagree")
    pub = {"kty": "OKP", "crv": "Ed25519", "x": root["x"], "kid": root["kid"]}
    key = _crypto.scrypt(passphrase or "", unb64u(s["salt"]), s["N"], s["r"], s["p"])
    try:
        seed = _crypto.aes256gcm_open(key, unb64u(s["iv"]), unb64u(s["ct"]), unb64u(s["tag"]), _root_aad(pub))
    except Exception:
        raise ValueError("cannot open the Root keystore: wrong passphrase or the keystore was modified") from None
    if len(seed) != 32 or b64u(_crypto.public_from_seed(seed)) != root["x"]:
        raise ValueError("Root keystore holds a key that is not this Root")
    return {**pub, "d": b64u(seed)}


def directory_document(session_public_jwks) -> dict:
    """The key directory: SESSION keys only. The Root never signs, so it is never here."""
    return {"keys": [{"kty": "OKP", "crv": "Ed25519", "kid": k["kid"], "x": k["x"], "use": "sig"} for k in session_public_jwks]}


# Where an MCP client receives its authorization code (ADR-039, RFC 8252 §7.3): loopback only, any port.
LOOPBACK_REDIRECT_URIS = ("http://127.0.0.1/callback", "http://[::1]/callback")
# The only way the card and the client document say the agent authenticates: its own key (MCP-3, MCP-4).
# A Card Host serves no document that says anything else.
TOKEN_AUTH_METHOD = "private_key_jwt"


def _oauth(origin: str) -> dict:
    return {
        "jwks_uri": f"{origin}{DIRECTORY_PATH}",
        "redirect_uris": list(LOOPBACK_REDIRECT_URIS),
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "token_endpoint_auth_method": TOKEN_AUTH_METHOD,
    }


def card_document(origin: str, name: str, contacts, diver: str, root_kid: str) -> dict:
    """Signature Agent Card: a CIMD document with web_bot_auth, Ludion data under `ludion` (the JS cardDocument)."""
    origin = origin.rstrip("/")
    return {
        "client_id": f"{origin}/card",
        "client_name": name,
        "contacts": list(contacts),
        **_oauth(origin),
        "web_bot_auth": {"trigger": "fetcher"},
        "ludion": {"version": 0, "diver_id": diver, "registry": "https://registry.ludion.ai", "root_kid": root_kid},
    }


def client_document(origin: str, name: str, contacts) -> dict:
    """The agent's OAuth client document for MCP (CIMD, no extensions; the JS clientDocument): its client_id."""
    origin = origin.rstrip("/")
    return {
        "client_id": f"{origin}/client",
        "client_name": name,
        **({"contacts": list(contacts)} if contacts else {}),
        **_oauth(origin),
    }
