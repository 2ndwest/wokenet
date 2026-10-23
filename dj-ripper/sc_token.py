#!/usr/bin/env python3
"""
Keeps a SoundCloud access token fresh so the ripper can run unattended.

Access tokens from soundcloud.com last 24h. This stores the access token and
its refresh token in a 600-mode JSON file and swaps in a new pair shortly
before expiry. Refresh tokens are single-use, so the new pair is written to
disk before anything else happens with it.

    python sc_token.py seed <access_token> <refresh_token>   # once
    python sc_token.py status
    python sc_token.py refresh                               # force one now
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_FILE = Path.home() / ".wokenet-ripper-sc.json"
TOKEN_URL = "https://secure.soundcloud.com/oauth/token"
REFRESH_MARGIN = 2 * 3600  # refresh when less than this many seconds remain
RETRY_AFTER = 600  # after a failed refresh, wait this long before trying again

_last_failure = 0.0


def _claims(jwt: str) -> dict:
    payload = jwt.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def _save(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def _record(access: str, refresh: str) -> dict:
    claims = _claims(access)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "client_id": claims["client_id"],
        "expires_at": claims["exp"],
    }


def refresh(path: Path = DEFAULT_FILE) -> dict:
    data = json.loads(path.read_text())
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": data["client_id"],
        "refresh_token": data["refresh_token"],
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        got = json.loads(res.read())
    new = _record(got["access_token"], got.get("refresh_token") or data["refresh_token"])
    _save(path, new)
    return new


def current(path: Path = DEFAULT_FILE) -> str | None:
    """The access token to use right now, refreshing it first if it's close to expiry."""
    global _last_failure
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    remaining = data["expires_at"] - time.time()
    if remaining < REFRESH_MARGIN and time.time() - _last_failure > RETRY_AFTER:
        try:
            data = refresh(path)
            print(f"  soundcloud token refreshed, valid until {time.ctime(data['expires_at'])}")
        except Exception as exc:
            _last_failure = time.time()
            detail = exc.read().decode(errors="replace")[:200] if hasattr(exc, "read") else ""
            print(f"  soundcloud token refresh failed: {exc} {detail}"[:300])
    if data["expires_at"] <= time.time():
        return None
    return data["access_token"]


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "seed" and len(sys.argv) == 4:
        _save(DEFAULT_FILE, _record(sys.argv[2], sys.argv[3]))
        cmd = "status"
    elif cmd == "refresh":
        refresh()
        cmd = "status"
    if cmd == "status":
        data = json.loads(DEFAULT_FILE.read_text())
        left = (data["expires_at"] - time.time()) / 3600
        print(f"{DEFAULT_FILE}: access token valid until {time.ctime(data['expires_at'])} ({left:.1f}h left)")
        return
    sys.exit(__doc__)


if __name__ == "__main__":
    main()
