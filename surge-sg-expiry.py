#!/usr/bin/env python3
"""Remove one temporary Surge portfolio after its fixed expiry.

No account operations happen at import. Production HTTP destination and deadline
are constants, not command-line options. Provision a token scoped ONLY to DOMAIN
in a regular 0600 file owned by the process user (root on the intended server).
The token is never printed, put in argv, or persisted in the state JSON.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
from pathlib import Path
import signal
import stat
import tempfile
import time
import urllib.error
import urllib.request

DOMAIN = "kai-xiao-portfolio-20261116.139-59-195-30.sslip.io"
ENDPOINT = "https://surge.surge.sh/" + DOMAIN
DEADLINE = 1794841800  # 2026-11-16 15:10:00 UTC
MAX_SLEEP = 60.0
MAX_BACKOFF = 900.0
HTTP_TIMEOUT = 25.0


def utc(epoch: float) -> str:
    return dt.datetime.fromtimestamp(epoch, dt.timezone.utc).isoformat()


class TokenFileError(Exception):
    """Intentionally contains no path, content, or lower-level exception."""


def read_token(path: Path) -> str:
    fd = None
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        fd = os.open(path, flags)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
                or info.st_uid != os.geteuid() or not 1 <= info.st_size <= 4096):
            raise TokenFileError()
        raw = os.read(fd, 4097)
        token = raw.decode("utf-8").strip()
        if not token or len(raw) > 4096 or any(ch.isspace() for ch in token):
            raise TokenFileError()
        return token
    except (OSError, UnicodeError):
        raise TokenFileError() from None
    finally:
        if fd is not None:
            os.close(fd)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def delete_project(token: str) -> tuple[int, bool]:
    """One verified-TLS DELETE; no proxy inheritance or credential redirects."""
    auth = base64.b64encode(("token:" + token).encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
        ENDPOINT, method="DELETE",
        headers={"Authorization": "Basic " + auth,
                 "Accept": "application/json", "User-Agent": "Kai-Portfolio-Expiry/1.0"},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=HTTP_TIMEOUT) as response:
            code = response.status
            body = response.read(4097)
    except urllib.error.HTTPError as exc:
        # Do not read or log API error text, request headers, or credentials.
        code = exc.code
        exc.close()
        return code, False
    try:
        payload = json.loads(body) if len(body) <= 4096 else None
    except (UnicodeError, ValueError):
        payload = None
    return code, code == 200 and isinstance(payload, dict) and payload.get("msg") == "project removed"


class ExpiryWatchdog:
    # Injection points are for offline tests only; CLI exposes no alternate target.
    def __init__(self, token_file: Path, state_file: Path, *, clock=time.time,
                 sleeper=time.sleep, transport=delete_project):
        self.token_file = token_file
        self.state_file = state_file
        self.clock = clock
        self.sleeper = sleeper
        self.transport = transport
        self.stopped = False
        self.backoff = 5.0
        self.state = self.load_state()

    def load_state(self) -> dict:
        try:
            value = json.loads(self.state_file.read_text())
        except (OSError, ValueError):
            return {}
        allowed = {"status", "deadline_utc", "updated_at_utc", "first_attempt_at_utc",
                   "last_attempt_at_utc", "next_attempt_at_utc", "deleted_at_utc", "http_status"}
        if not isinstance(value, dict) or value.get("deadline_utc") != utc(DEADLINE):
            return {}
        clean = {}
        statuses = {"waiting_for_deadline", "attempting_delete", "http_failure",
                    "unexpected_success_body", "token_file_unavailable_or_unsafe",
                    "network_failure", "deleted", "stopped"}
        for key, item in value.items():
            if key not in allowed:
                continue
            if key == "status" and isinstance(item, str) and item in statuses:
                clean[key] = item
            elif key == "http_status" and type(item) is int and 100 <= item <= 599:
                clean[key] = item
            elif key.endswith("_utc") and self.parse_time(item) is not None:
                clean[key] = item
        return clean

    def save(self, status: str, *, code: int | None = None, next_at: float | None = None):
        self.state.update(status=status, deadline_utc=utc(DEADLINE), updated_at_utc=utc(self.clock()))
        self.state.pop("http_status", None)
        self.state.pop("next_attempt_at_utc", None)
        if code is not None:
            self.state["http_status"] = code
        if next_at is not None:
            self.state["next_attempt_at_utc"] = utc(next_at)
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".surge-expiry-", dir=self.state_file.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(self.state, stream, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp, self.state_file)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    @staticmethod
    def parse_time(value) -> float | None:
        try:
            stamp = dt.datetime.fromisoformat(value)
            return stamp.timestamp() if stamp.tzinfo is not None else None
        except (TypeError, ValueError, OverflowError):
            return None

    def completed(self) -> bool:
        when = self.parse_time(self.state.get("deleted_at_utc"))
        return self.state.get("status") == "deleted" and when is not None and when >= DEADLINE

    def halt(self, *_):
        self.stopped = True

    def run(self, *, once: bool = False) -> int:
        if self.completed():
            return 0
        retry_at = self.parse_time(self.state.get("next_attempt_at_utc")) or 0.0
        # Bound an invalid future retry timestamp; the deadline itself stays fixed.
        retry_at = min(retry_at, self.clock() + MAX_BACKOFF)
        while not self.stopped:
            now = self.clock()
            if now < DEADLINE:
                self.save("waiting_for_deadline")
                if once:
                    return 0
                self.sleeper(min(MAX_SLEEP, DEADLINE - now))
                continue
            if now < retry_at:
                if once:
                    return 1
                self.sleeper(min(MAX_SLEEP, retry_at - now))
                continue
            # Recheck immediately before reading credentials and sending DELETE.
            if self.clock() < DEADLINE:
                continue
            attempt_at = utc(self.clock())
            self.state.setdefault("first_attempt_at_utc", attempt_at)
            self.state["last_attempt_at_utc"] = attempt_at
            self.save("attempting_delete")
            code = None
            try:
                token = read_token(self.token_file)
                if self.stopped or self.clock() < DEADLINE:
                    del token
                    continue
                code, removed = self.transport(token)
                del token
                status = "http_failure" if code != 200 else "unexpected_success_body"
            except TokenFileError:
                removed = False
                status = "token_file_unavailable_or_unsafe"
            except Exception:
                # Network exception messages may echo credentials; never persist them.
                removed = False
                status = "network_failure"
            if removed:
                self.state["deleted_at_utc"] = utc(self.clock())
                self.save("deleted", code=code)
                return 0
            retry_at = self.clock() + self.backoff
            self.save(status, code=code, next_at=retry_at)
            self.backoff = min(MAX_BACKOFF, self.backoff * 2)
            if once:
                return 1
        self.save("stopped")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token-file", required=True, type=Path,
                        help="Path to the scoped token file, never the token itself")
    parser.add_argument("--state-file", required=True, type=Path)
    parser.add_argument("--once", action="store_true", help="One due attempt, for scheduled backup jobs")
    args = parser.parse_args()
    if args.token_file.resolve() == args.state_file.resolve():
        parser.error("Token and state files must be different")
    os.umask(0o077)
    watcher = ExpiryWatchdog(args.token_file, args.state_file)
    signal.signal(signal.SIGTERM, watcher.halt)
    signal.signal(signal.SIGINT, watcher.halt)
    try:
        return watcher.run(once=args.once)
    except Exception:
        # State write or filesystem failure: stop rather than run without audit state.
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
