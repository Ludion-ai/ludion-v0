"""Every cryptographic primitive the Python Diver uses, in one place (spec §15.3, CRY-1's rule).

All of it is `cryptography` (OpenSSL): Ed25519 key generation and public-key derivation,
scrypt, AES-256-GCM. Signing itself happens inside `http-message-signatures`, which is handed
the key object built here. Nothing else in the package touches a primitive.
"""

import os

from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

SEED_BYTES = 32


def random_bytes(n: int) -> bytes:
    return os.urandom(n)


def generate_seed() -> bytes:
    """A fresh Ed25519 private key, as its 32-byte seed (JWK `d`)."""
    return ed25519.Ed25519PrivateKey.generate().private_bytes_raw()


def public_from_seed(seed: bytes) -> bytes:
    """The 32-byte Ed25519 public key (JWK `x`) of a seed, derived by OpenSSL."""
    if len(seed) != SEED_BYTES:
        raise ValueError("an Ed25519 seed is 32 bytes")
    return ed25519.Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)


def signing_key(seed: bytes) -> ed25519.Ed25519PrivateKey:
    """The key object http-message-signatures signs with. Session keys only (spec §10.3)."""
    return ed25519.Ed25519PrivateKey.from_private_bytes(seed)


def scrypt(passphrase: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    import unicodedata

    return Scrypt(salt=salt, length=32, n=n, r=r, p=p).derive(unicodedata.normalize("NFKC", passphrase).encode("utf-8"))


def aes256gcm_seal(key: bytes, iv: bytes, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
    """Returns (ciphertext, 16-byte tag), stored apart like the JS keystore does."""
    out = AESGCM(key).encrypt(iv, plaintext, aad)
    return out[:-16], out[-16:]


def aes256gcm_open(key: bytes, iv: bytes, ciphertext: bytes, tag: bytes, aad: bytes) -> bytes:
    return AESGCM(key).decrypt(iv, ciphertext + tag, aad)
