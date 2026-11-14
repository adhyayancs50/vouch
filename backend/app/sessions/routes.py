"""Interview session endpoints (Milestone 4). DEVELOPMENT MODE ONLY.

Registered only when ``VOUCH_ENABLE_DEV_ENDPOINTS=true`` and only for local
clients. Employer identity comes from the ``X-Vouch-Dev-Employer`` header,
which is a development stand-in, not authentication.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.core.access import require_dev_employer, require_local_client
from app.core.errors import ApiError
from app.db import get_db, utcnow
from app.sessions import join_codes
from app.sessions.models import InterviewSession, SessionCandidate, SessionStatus
from app.sessions.schemas import (
    CandidateOut,
    JoinRequest,
    JoinResponse,
    PolicyOut,
    SessionCreate,
    SessionCreated,
    SessionList,
    SessionOut,
)

logger = logging.getLogger("vouch.sessions")

router = APIRouter(
    prefix="/sessions",
    tags=["sessions (development)"],
    dependencies=[Depends(require_local_client)],
)


def _policy(session: InterviewSession) -> PolicyOut:
    return PolicyOut(
        ai_usage=session.ai_usage,
        allowed_domains=list(session.allowed_domains or []),
        restricted_domains=list(session.restricted_domains or []),
    )


def _session_out(session: InterviewSession) -> dict:
    candidate = session.candidate
    return {
        "session_id": session.id,
        "title": session.title,
        "candidate_name": session.candidate_name,
        "status": session.status,
        "policy": _policy(session),
        "created_at": session.created_at,
        "join_code_expires_at": session.join_code_expires_at,
        "joined_at": session.joined_at,
        "candidate": None
        if candidate is None
        else CandidateOut(
            candidate_id=candidate.id, name=candidate.display_name, joined_at=candidate.joined_at
        ),
    }


@router.post("", status_code=201, response_model=SessionCreated)
def create_session(
    payload: SessionCreate,
    request: Request,
    employer_id: int = Depends(require_dev_employer),
    db: DbSession = Depends(get_db),
) -> SessionCreated:
    ttl = timedelta(hours=request.app.state.settings.join_code_ttl_hours)
    for _ in range(3):  # a hash collision is astronomically unlikely; retry anyway
        code = join_codes.generate_join_code()
        now = utcnow()
        session = InterviewSession(
            id=f"sess_{uuid.uuid4().hex}",
            employer_id=employer_id,
            title=payload.title,
            candidate_name=payload.candidate_name,
            ai_usage=payload.policy.ai_usage,
            allowed_domains=payload.policy.allowed_domains,
            restricted_domains=payload.policy.restricted_domains,
            status=SessionStatus.CREATED,
            join_code_hash=join_codes.hash_join_code(join_codes.normalize_join_code(code)),
            join_code_expires_at=now + ttl,
            created_at=now,
        )
        db.add(session)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        logger.info("Created session %s", session.id)  # never log the join code
        return SessionCreated(**_session_out(session), candidate_join_code=code)
    raise ApiError(500, "INTERNAL_ERROR", "Could not create the session. Please try again.")


@router.get("", response_model=SessionList)
def list_sessions(
    employer_id: int = Depends(require_dev_employer), db: DbSession = Depends(get_db)
) -> SessionList:
    sessions = db.scalars(
        select(InterviewSession)
        .where(InterviewSession.employer_id == employer_id)
        .order_by(InterviewSession.created_at.desc(), InterviewSession.id)
    ).all()
    return SessionList(
        total_sessions=len(sessions), sessions=[SessionOut(**_session_out(s)) for s in sessions]
    )


@router.post("/join", response_model=JoinResponse)
def join_session(
    payload: JoinRequest, request: Request, db: DbSession = Depends(get_db)
) -> JoinResponse:
    limiter: join_codes.JoinAttemptLimiter = request.app.state.join_limiter
    client_key = request.client.host if request.client else "unknown"

    retry_after = limiter.retry_after(client_key)
    if retry_after is not None:
        raise ApiError(
            429,
            "TOO_MANY_ATTEMPTS",
            f"Too many invalid join attempts. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    normalized = join_codes.normalize_join_code(payload.join_code)
    session = (
        db.scalar(
            select(InterviewSession).where(
                InterviewSession.join_code_hash == join_codes.hash_join_code(normalized)
            )
        )
        if normalized
        else None
    )
    if session is None:
        limiter.record_failure(client_key)
        raise ApiError(401, "INVALID_JOIN_CODE", "That join code is not valid. Check it and try again.")

    now = utcnow()
    if session.status != SessionStatus.CREATED:
        raise ApiError(
            409, "SESSION_ALREADY_JOINED", "This session has already been joined. Ask the employer for a new session."
        )
    if now >= session.join_code_expires_at:
        raise ApiError(410, "JOIN_CODE_EXPIRED", "This join code has expired. Ask the employer for a new session.")

    # Atomic CREATED -> JOINED, so two simultaneous joins cannot both succeed.
    claimed = db.execute(
        update(InterviewSession)
        .where(InterviewSession.id == session.id, InterviewSession.status == SessionStatus.CREATED)
        .values(status=SessionStatus.JOINED, joined_at=now)
    ).rowcount
    if claimed != 1:
        db.rollback()
        raise ApiError(
            409, "SESSION_ALREADY_JOINED", "This session has already been joined. Ask the employer for a new session."
        )
    candidate = SessionCandidate(
        id=f"cand_{uuid.uuid4().hex}",
        session_id=session.id,
        display_name=payload.candidate_name or session.candidate_name,
        joined_at=now,
    )
    db.add(candidate)
    db.commit()
    limiter.reset(client_key)
    logger.info("Candidate %s joined session %s", candidate.id, session.id)

    return JoinResponse(
        session_id=session.id,
        title=session.title,
        status=SessionStatus.JOINED,
        policy=_policy(session),
        candidate_id=candidate.id,
        candidate_name=candidate.display_name,
        joined_at=now,
    )


@router.get("/{session_id}", response_model=SessionOut)
def get_session(
    session_id: str,
    employer_id: int = Depends(require_dev_employer),
    db: DbSession = Depends(get_db),
) -> SessionOut:
    session = db.get(InterviewSession, session_id)
    # Another employer's session is reported as missing, not forbidden.
    if session is None or session.employer_id != employer_id:
        raise ApiError(404, "SESSION_NOT_FOUND", "No session with that ID exists for this employer.")
    return SessionOut(**_session_out(session))
