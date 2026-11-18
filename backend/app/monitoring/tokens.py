"""Candidate credentials: random bearer tokens issued once, at join.

``vct_`` + 43 URL-safe characters (256 bits from ``secrets``). Only a SHA-256
digest is stored. There is deliberately no endpoint that re-issues or reveals a
token: a candidate who loses it needs a new session.
"""

from __future__ import annotations

import hashlib
import secrets

TOKEN_PREFIX = "vct_"
_HASH_PREFIX = b"vouch-candidate-token:v1:"


def generate_candidate_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def hash_candidate_token(token: str) -> str:
    return hashlib.sha256(_HASH_PREFIX + token.encode("utf-8")).hexdigest()


def looks_like_candidate_token(value: str) -> bool:
    return value.startswith(TOKEN_PREFIX) and 20 <= len(value) <= 100 and value.isascii()
