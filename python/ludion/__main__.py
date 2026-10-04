"""python -m ludion — the Python Diver CLI.

    python -m ludion init [--name "My Agent"] [--contact mailto:ops@example.com] [--domain HOST] [--dev] [--force]
    python -m ludion sign METHOD URL [--body '...'] [--cimd]

The Root private key is sealed in ludion.json with LUDION_ROOT_PASSPHRASE (or a prompt on a
terminal); only --dev (or LUDION_DEV=1) stores it in plaintext.
"""

import argparse
import getpass
import os
import sys

from . import keys
from .diver import Diver, init


def _passphrase():
    if os.environ.get("LUDION_ROOT_PASSPHRASE"):
        return os.environ["LUDION_ROOT_PASSPHRASE"]
    if not sys.stdin.isatty():
        return None
    a = getpass.getpass(f"Root passphrase (at least {keys.MIN_PASSPHRASE_LENGTH} characters): ")
    if a != getpass.getpass("Repeat the passphrase: "):
        raise SystemExit("✖ the passphrases do not match. Nothing was written.")
    return a


def main(argv=None):
    # A console that cannot encode ✔/⚠ (cp932 on Japanese Windows, ascii) must not crash the CLI:
    # stdout is "strict" by default there. stderr already defaults to backslashreplace.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    p = argparse.ArgumentParser(prog="python -m ludion")
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init")
    i.add_argument("--name", default="Unnamed agent")
    i.add_argument("--contact", default="mailto:change-me@example.com")
    i.add_argument("--domain")
    i.add_argument("--dev", action="store_true")
    i.add_argument("--force", action="store_true")
    s = sub.add_parser("sign")
    s.add_argument("method")
    s.add_argument("url")
    s.add_argument("--body")
    s.add_argument("--cimd", action="store_true")
    a = p.parse_args(argv)
    try:
        if a.cmd == "init":
            dev = a.dev or os.environ.get("LUDION_DEV") == "1"
            store = init(".", name=a.name, contact=a.contact, domain=a.domain, dev=dev, force=a.force,
                         passphrase=None if dev else _passphrase())
            print(f"✔ Diver created: {store['diver_id']}")
            print(f"  Signature-Agent: {store['signature_agent']}")
            print(f"  Wrote ludion.json (KEEP PRIVATE — {'DEV MODE: Root key in plaintext' if dev else 'Root key sealed with your passphrase'})")
            print(f"  Wrote .well-known/http-message-signatures-directory  ← publish at {store['signature_agent']}/.well-known/http-message-signatures-directory")
            print(f"  Wrote card                                            ← publish at {store['signature_agent']}/card")
        else:
            diver = Diver.load("ludion.json", cimd=a.cimd)
            for name, value in diver.headers_for(a.method, a.url, {}, a.body).items():
                print(f"{name}: {value}")
    except (ValueError, FileExistsError, FileNotFoundError) as e:
        print(f"✖ {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
