"""Candidate authentication with the bearer token issued at join (development only)."""

from __future__ import annotations

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.errors import ApiError
from app.db import get_db, utcnow
from app.monitoring import tokens
from app.sessions.models import SessionCandidate

_BEARER = {"WWW-Authenticate": "Bearer"}


def require_candidate(
    session_id: str,
    authorization: str | None = Header(default=None),
    db: DbSession = Depends(get_db),
) -> SessionCandidate:
    """Resolve the candidate from ``Authorization: Bearer <token>``.

    Identity always comes from the token. The ``session_id`` in the URL must be
    the token's own session; it is never trusted on its own.
    """
    scheme, _, token = (authorization or "").partition(" ")
    token = token.strip()
    if not authorization or scheme.lower() != "bearer" or not token:
        raise ApiError(
            401,
            "CANDIDATE_TOKEN_REQUIRED",
            "Send the candidate token from the join response as 'Authorization: Bearer <token>'.",
            headers=_BEARER,
        )

    candidate = None
    if tokens.looks_like_candidate_token(token):
        candidate = db.scalar(
            select(SessionCandidate).where(
                SessionCandidate.token_hash == tokens.hash_candidate_token(token)
            )
        )
    if candidate is None:
        raise ApiError(401, "INVALID_CANDIDATE_TOKEN", "The candidate token is not valid.", headers=_BEARER)
    if utcnow() >= candidate.token_expires_at:
        raise ApiError(
            401,
            "CANDIDATE_TOKEN_EXPIRED",
            "The candidate token has expired. Ask the employer for a new session.",
            headers=_BEARER,
        )
    if candidate.session_id != session_id:
        raise ApiError(403, "SESSION_MISMATCH", "This candidate token does not belong to that session.")
    return candidate
