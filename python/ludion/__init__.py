"""Ludion Diver for Python: a Web Bot Auth (RFC 9421) identity and one-line signing for agents.

    from ludion import DiverAuth
    client = httpx.Client(auth=DiverAuth.from_env())

See `python -m ludion --help`. Keys, keystore and Card are byte-compatible with the JS CLI.
"""

from .diver import Diver, DiverAuth, init
from .keys import diver_id, open_root, seal_root, thumbprint
from .sign import Signer

__all__ = ["Diver", "DiverAuth", "Signer", "init", "diver_id", "open_root", "seal_root", "thumbprint"]
