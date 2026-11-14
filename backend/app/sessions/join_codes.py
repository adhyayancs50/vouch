"""Candidate join codes and failed-attempt limiting.

Codes are 16 characters from a 30-symbol alphabet without look-alike
characters (no 0/O, 1/I/L, U), about 78 bits of randomness from ``secrets``.
They are shown as ``ABCD-EFGH-JKMN-PQRS``. Only a SHA-256 digest is stored:
with this much randomness a fast hash is safe, and lookup by digest needs no
server secret, so codes stay valid across restarts.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from collections import deque

ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
CODE_LENGTH = 16
GROUP = 4
_HASH_PREFIX = b"vouch-join-code:v1:"


def generate_join_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
    return "-".join(raw[i : i + GROUP] for i in range(0, CODE_LENGTH, GROUP))


def normalize_join_code(value: str) -> str | None:
    """Uppercase and strip spaces/hyphens. Returns None if it cannot be a valid code."""
    cleaned = "".join(ch for ch in value.upper() if ch not in " -\t")
    if len(cleaned) != CODE_LENGTH or any(ch not in ALPHABET for ch in cleaned):
        return None
    return cleaned


def hash_join_code(normalized: str) -> str:
    return hashlib.sha256(_HASH_PREFIX + normalized.encode("ascii")).hexdigest()


class JoinAttemptLimiter:
    """In-memory sliding-window limit on failed joins per client.

    Development MVP only: state is per process and resets on restart.
    """

    def __init__(self, max_failures: int, window_seconds: int) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        attempts = self._failures.setdefault(key, deque())
        while attempts and now - attempts[0] >= self.window_seconds:
            attempts.popleft()
        return attempts

    def retry_after(self, key: str) -> int | None:
        """Seconds until another attempt is allowed, or None if not blocked."""
        now = time.monotonic()
        with self._lock:
            attempts = self._prune(key, now)
            if len(attempts) < self.max_failures:
                return None
            return max(1, int(self.window_seconds - (now - attempts[0])) + 1)

    def record_failure(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(key, now).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
