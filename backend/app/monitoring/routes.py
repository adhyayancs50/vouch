"""Consent, monitoring lifecycle and browser events (Milestone 5). DEVELOPMENT MODE ONLY.

Candidate routes authenticate with the bearer token issued at join; employer
routes use the development X-Vouch-Dev-Employer header. Every route is
local-only and registered only when VOUCH_ENABLE_DEV_ENDPOINTS=true.

State rules (also in backend/API_MONITORING.md):

Consent      GRANTED    from NONE / DECLINED / WITHDRAWN, only while monitoring is NOT_STARTED
             DECLINED   from NONE (repeat or after WITHDRAWN: no change); 409 if GRANTED
             WITHDRAWN  from GRANTED, any time; stops ACTIVE monitoring; 409 if never granted
Monitoring   start      NOT_STARTED -> ACTIVE, needs current GRANTED consent; repeat is a no-op;
                        409 once STOPPED (never restarts)
             stop       ACTIVE -> STOPPED; repeat is a no-op; 409 if NOT_STARTED
Events       accepted only while ACTIVE

SQLite write transactions begin with BEGIN IMMEDIATE, so event submission, stop,
and consent withdrawal cannot hold a write lock at the same time. Cutoff clocks
(``received_at``, ``monitoring_stopped_at``) are read only after the statement
that claims the transition has returned. An event whose transaction commits
before that claim is kept. Once the stop or withdrawal commits, a later event
transaction sees STOPPED and stores nothing.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Request
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession

from app.core.access import require_dev_employer, require_local_client
from app.core.errors import ApiError
from app.db import get_db, utcnow
from app.monitoring.auth import require_candidate
from app.monitoring.models import ActivityEvent, ConsentRecord
from app.monitoring.schemas import (
    CandidateState,
    CandidateStateChange,
    ConsentHistoryEntry,
    ConsentRequest,
    ConsentState,
    EmployerConsentView,
    EmployerMonitoringState,
    EmployerMonitoringView,
    EventBatch,
    EventBatchResult,
    EventList,
    EventOut,
    EventResult,
    MonitoringState,
)
from app.monitoring.states import ConsentDecision, ConsentStatus, MonitoringStatus, StopReason
from app.sessions.models import InterviewSession, SessionCandidate
from app.sessions.schemas import CandidateOut, PolicyOut

logger = logging.getLogger("vouch.monitoring")

router = APIRouter(
    prefix="/sessions",
    tags=["monitoring (development)"],
    dependencies=[Depends(require_local_client)],
)


def _policy(session: InterviewSession) -> PolicyOut:
    return PolicyOut(
        ai_usage=session.ai_usage,
        allowed_domains=list(session.allowed_domains or []),
        restricted_domains=list(session.restricted_domains or []),
    )


def _monitoring(c: SessionCandidate) -> dict:
    return {
        "status": c.monitoring_status,
        "started_at": c.monitoring_started_at,
        "stopped_at": c.monitoring_stopped_at,
        "stop_reason": c.monitoring_stop_reason,
        "events_received": c.events_received,
    }


def _candidate_state(c: SessionCandidate, request: Request) -> dict:
    return {
        "session_id": c.session_id,
        "candidate_id": c.id,
        "title": c.session.title,
        "policy": _policy(c.session),
        "consent": ConsentState(
            status=c.consent_status,
            consent_version=c.consent_version,
            updated_at=c.consent_updated_at,
            required_version=request.app.state.settings.consent_version,
        ),
        "monitoring": MonitoringState(**_monitoring(c)),
        "candidate_token_expires_at": c.token_expires_at,
    }


def _reload(db: DbSession, candidate: SessionCandidate) -> SessionCandidate:
    db.refresh(candidate)
    return candidate


# --- candidate ---------------------------------------------------------------


@router.get("/{session_id}/candidate", response_model=CandidateState)
def get_candidate_state(
    request: Request, candidate: SessionCandidate = Depends(require_candidate)
) -> CandidateState:
    return CandidateState(**_candidate_state(candidate, request))


@router.post("/{session_id}/consent", response_model=CandidateStateChange)
def record_consent(
    payload: ConsentRequest,
    request: Request,
    candidate: SessionCandidate = Depends(require_candidate),
    db: DbSession = Depends(get_db),
) -> CandidateStateChange:
    required = request.app.state.settings.consent_version
    current = candidate.consent_status
    decision = payload.decision

    if decision is ConsentDecision.GRANTED:
        if candidate.monitoring_status is MonitoringStatus.STOPPED:
            raise ApiError(
                409,
                "MONITORING_ALREADY_STOPPED",
                "Monitoring for this session has ended and cannot be restarted. "
                "Ask the employer for a new session.",
            )
        if payload.consent_version != required:
            raise ApiError(
                409,
                "CONSENT_VERSION_MISMATCH",
                f"Consent must be given to the current disclosure (version {required}). "
                "Show the latest disclosure and try again.",
            )
        changed = not (current is ConsentStatus.GRANTED and candidate.consent_version == required)
        new_status = ConsentStatus.GRANTED
    elif decision is ConsentDecision.DECLINED:
        if current is ConsentStatus.GRANTED:
            raise ApiError(
                409,
                "CONSENT_ALREADY_GRANTED",
                "Consent was already given. Send decision WITHDRAWN to withdraw it.",
            )
        changed = current is ConsentStatus.NONE
        new_status = ConsentStatus.DECLINED if changed else current
    else:  # WITHDRAWN
        if current in (ConsentStatus.NONE, ConsentStatus.DECLINED):
            raise ApiError(409, "CONSENT_NOT_GRANTED", "There is no granted consent to withdraw.")
        changed = current is ConsentStatus.GRANTED
        new_status = ConsentStatus.WITHDRAWN

    if changed:
        # Claim ACTIVE -> STOPPED before reading the clock. The timestamp is not
        # bound until this update returns, so it cannot be earlier than an event
        # transaction that already committed.
        stopped_monitoring = False
        if decision is ConsentDecision.WITHDRAWN:
            stopped_monitoring = (
                db.execute(
                    update(SessionCandidate)
                    .where(
                        SessionCandidate.id == candidate.id,
                        SessionCandidate.monitoring_status == MonitoringStatus.ACTIVE,
                    )
                    .values(
                        monitoring_status=MonitoringStatus.STOPPED,
                        monitoring_stop_reason=StopReason.CONSENT_WITHDRAWN,
                    )
                ).rowcount
                == 1
            )
        now = utcnow()
        db.execute(
            update(SessionCandidate)
            .where(SessionCandidate.id == candidate.id)
            .values(
                consent_status=new_status,
                consent_version=payload.consent_version or candidate.consent_version,
                consent_updated_at=now,
                **({"monitoring_stopped_at": now} if stopped_monitoring else {}),
            )
        )
        db.add(
            ConsentRecord(
                session_id=candidate.session_id,
                candidate_id=candidate.id,
                decision=decision,
                consent_version=payload.consent_version,
                recorded_at=now,
            )
        )
        db.commit()
        logger.info("Candidate %s consent %s", candidate.id, decision.value)
    return CandidateStateChange(**_candidate_state(_reload(db, candidate), request), changed=changed)


@router.post("/{session_id}/monitoring/start", response_model=CandidateStateChange)
def start_monitoring(
    request: Request,
    candidate: SessionCandidate = Depends(require_candidate),
    db: DbSession = Depends(get_db),
) -> CandidateStateChange:
    required = request.app.state.settings.consent_version
    if candidate.monitoring_status is MonitoringStatus.STOPPED:
        raise ApiError(
            409,
            "MONITORING_ALREADY_STOPPED",
            "Monitoring for this session has ended and cannot be restarted. "
            "Ask the employer for a new session.",
        )
    if candidate.monitoring_status is MonitoringStatus.ACTIVE:
        return CandidateStateChange(**_candidate_state(candidate, request), changed=False)
    if candidate.consent_status is not ConsentStatus.GRANTED:
        raise ApiError(409, "CONSENT_REQUIRED", "The candidate must consent before monitoring can start.")
    if candidate.consent_version != required:
        raise ApiError(
            409,
            "CONSENT_VERSION_MISMATCH",
            f"The disclosure changed (now version {required}). Ask for consent again before starting.",
        )

    started = db.execute(
        update(SessionCandidate)
        .where(
            SessionCandidate.id == candidate.id,
            SessionCandidate.monitoring_status == MonitoringStatus.NOT_STARTED,
            SessionCandidate.consent_status == ConsentStatus.GRANTED,
            SessionCandidate.consent_version == required,
        )
        .values(monitoring_status=MonitoringStatus.ACTIVE, monitoring_started_at=utcnow())
    ).rowcount
    db.commit()
    candidate = _reload(db, candidate)
    if started != 1 and candidate.monitoring_status is not MonitoringStatus.ACTIVE:
        raise ApiError(409, "CONSENT_REQUIRED", "Consent changed while starting. Check consent and try again.")
    if started == 1:
        logger.info("Candidate %s monitoring started", candidate.id)
    return CandidateStateChange(**_candidate_state(candidate, request), changed=started == 1)


@router.post("/{session_id}/monitoring/stop", response_model=CandidateStateChange)
def stop_monitoring(
    request: Request,
    candidate: SessionCandidate = Depends(require_candidate),
    db: DbSession = Depends(get_db),
) -> CandidateStateChange:
    if candidate.monitoring_status is MonitoringStatus.NOT_STARTED:
        raise ApiError(409, "MONITORING_NOT_STARTED", "Monitoring has not started, so there is nothing to stop.")
    # Claim the transition before reading the clock. utcnow() as an argument of
    # this update would run before SQLite grants the write lock, so a committed
    # event could receive a later received_at than stopped_at.
    stopped = db.execute(
        update(SessionCandidate)
        .where(
            SessionCandidate.id == candidate.id,
            SessionCandidate.monitoring_status == MonitoringStatus.ACTIVE,
        )
        .values(
            monitoring_status=MonitoringStatus.STOPPED,
            monitoring_stop_reason=StopReason.CANDIDATE_STOPPED,
        )
    ).rowcount
    if stopped == 1:
        db.execute(
            update(SessionCandidate)
            .where(SessionCandidate.id == candidate.id)
            .values(monitoring_stopped_at=utcnow())
        )
        logger.info("Candidate %s monitoring stopped", candidate.id)
    db.commit()
    return CandidateStateChange(**_candidate_state(_reload(db, candidate), request), changed=stopped == 1)


_EVENTS_OPENAPI = {
    "requestBody": {
        "required": True,
        "content": {"application/json": {"schema": EventBatch.model_json_schema(ref_template="#/components/schemas/{model}")}},
    }
}


@router.post("/{session_id}/events", response_model=EventBatchResult, openapi_extra=_EVENTS_OPENAPI)
async def submit_events(
    request: Request,
    candidate: SessionCandidate = Depends(require_candidate),
    db: DbSession = Depends(get_db),
) -> EventBatchResult:
    settings = request.app.state.settings

    # Read the raw body ourselves so oversized requests are refused before parsing.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > settings.max_event_request_bytes:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", f"Send at most {settings.max_event_request_bytes} bytes per request.")
    raw = await request.body()
    if len(raw) > settings.max_event_request_bytes:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", f"Send at most {settings.max_event_request_bytes} bytes per request.")
    try:
        batch = EventBatch.model_validate_json(raw)
    except ValidationError as exc:
        raise RequestValidationError(
            [{**e, "loc": ("body", *e["loc"])} for e in exc.errors(include_url=False, include_input=False)]
        ) from None
    except (ValueError, json.JSONDecodeError):
        raise ApiError(422, "VALIDATION_ERROR", "The request body must be JSON.") from None
    if len(batch.events) > settings.max_events_per_request:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            f"Send at most {settings.max_events_per_request} events per request.",
        )

    if candidate.monitoring_status is not MonitoringStatus.ACTIVE:
        raise ApiError(
            409,
            "MONITORING_NOT_ACTIVE",
            "Events are accepted only while monitoring is ACTIVE "
            f"(it is {candidate.monitoring_status.value}).",
        )

    retry_after = request.app.state.event_limiter.try_consume(candidate.id, len(batch.events))
    if retry_after is not None:
        raise ApiError(
            429,
            "RATE_LIMITED",
            f"Too many events. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    # Claim the ACTIVE row before reading the clock or inserting. A stop or
    # withdrawal that already committed makes this match nothing, and this
    # transaction then stores no events.
    locked = db.execute(
        update(SessionCandidate)
        .where(
            SessionCandidate.id == candidate.id,
            SessionCandidate.monitoring_status == MonitoringStatus.ACTIVE,
        )
        .values(monitoring_status=MonitoringStatus.ACTIVE)
    ).rowcount
    if locked != 1:
        db.rollback()
        raise ApiError(409, "MONITORING_NOT_ACTIVE", "Monitoring stopped before these events were saved.")

    now = utcnow()
    db.execute(
        update(SessionCandidate)
        .where(SessionCandidate.id == candidate.id)
        .values(last_event_received_at=now)
    )
    skew = timedelta(seconds=settings.event_clock_skew_seconds)
    earliest = candidate.monitoring_started_at - skew
    latest = now + skew
    bad = [
        {
            "location": f"body.events.{i}.occurred_at",
            "message": "must be after monitoring started and not in the future",
            "type": "out_of_range",
        }
        for i, e in enumerate(batch.events)
        if not earliest <= e.occurred_at <= latest
    ]
    if bad:
        db.rollback()
        raise ApiError(
            422,
            "EVENT_TIMESTAMP_OUT_OF_RANGE",
            "Some events have timestamps before monitoring started or in the future. Check the device clock.",
            details=bad,
        )

    ids = [e.client_event_id for e in batch.events]
    existing = {
        row.client_event_id: row
        for row in db.scalars(
            select(ActivityEvent).where(
                ActivityEvent.candidate_id == candidate.id, ActivityEvent.client_event_id.in_(ids)
            )
        )
    }
    for event in batch.events:
        previous = existing.get(event.client_event_id)
        if previous is not None and not event.same_content(previous):
            db.rollback()
            raise ApiError(
                409,
                "EVENT_ID_CONFLICT",
                f"client_event_id {event.client_event_id} was already used for a different event. "
                "Nothing in this request was saved.",
            )

    new_events = [e for e in batch.events if e.client_event_id not in existing]
    stored_total = db.scalar(
        select(func.count()).select_from(ActivityEvent).where(ActivityEvent.session_id == candidate.session_id)
    )
    if stored_total + len(new_events) > settings.max_events_per_session:
        db.rollback()
        raise ApiError(
            409,
            "EVENT_LIMIT_REACHED",
            f"This session has reached its limit of {settings.max_events_per_session} events.",
        )

    results: list[EventResult] = []
    created: dict[str, str] = {}
    for event in new_events:
        event_id = f"evt_{uuid.uuid4().hex}"
        created[event.client_event_id] = event_id
        db.add(
            ActivityEvent(
                event_id=event_id,
                session_id=candidate.session_id,
                candidate_id=candidate.id,
                client_event_id=event.client_event_id,
                event_type=event.event_type,
                hostname=event.hostname,
                tab_id=event.tab_id,
                client_sequence=event.client_sequence,
                occurred_at=event.occurred_at,
                received_at=now,
            )
        )
    if new_events:
        db.execute(
            update(SessionCandidate)
            .where(SessionCandidate.id == candidate.id)
            .values(events_received=SessionCandidate.events_received + len(new_events))
        )
    db.commit()

    for event in batch.events:
        if event.client_event_id in created:
            results.append(EventResult(client_event_id=event.client_event_id, event_id=created[event.client_event_id], status="STORED"))
        else:
            results.append(
                EventResult(
                    client_event_id=event.client_event_id,
                    event_id=existing[event.client_event_id].event_id,
                    status="DUPLICATE",
                )
            )
    return EventBatchResult(stored=len(created), duplicates=len(batch.events) - len(created), results=results)


# --- employer (read only) ----------------------------------------------------


def _employer_session(session_id: str, employer_id: int, db: DbSession) -> InterviewSession:
    session = db.get(InterviewSession, session_id)
    if session is None or session.employer_id != employer_id:
        raise ApiError(404, "SESSION_NOT_FOUND", "No session with that ID exists for this employer.")
    return session


@router.get("/{session_id}/monitoring", response_model=EmployerMonitoringView)
def get_monitoring(
    session_id: str,
    employer_id: int = Depends(require_dev_employer),
    db: DbSession = Depends(get_db),
) -> EmployerMonitoringView:
    session = _employer_session(session_id, employer_id, db)
    c = session.candidate
    history = (
        db.scalars(
            select(ConsentRecord).where(ConsentRecord.candidate_id == c.id).order_by(ConsentRecord.id)
        ).all()
        if c
        else []
    )
    return EmployerMonitoringView(
        session_id=session.id,
        session_status=session.status,
        candidate=None
        if c is None
        else CandidateOut(candidate_id=c.id, name=c.display_name, joined_at=c.joined_at),
        consent=EmployerConsentView(
            status=c.consent_status if c else ConsentStatus.NONE,
            consent_version=c.consent_version if c else None,
            updated_at=c.consent_updated_at if c else None,
            history=[
                ConsentHistoryEntry(decision=h.decision, consent_version=h.consent_version, recorded_at=h.recorded_at)
                for h in history
            ],
        ),
        monitoring=EmployerMonitoringState(
            **(
                _monitoring(c)
                if c
                else {
                    "status": MonitoringStatus.NOT_STARTED,
                    "started_at": None,
                    "stopped_at": None,
                    "stop_reason": None,
                    "events_received": 0,
                }
            ),
            last_event_received_at=c.last_event_received_at if c else None,
        ),
    )


@router.get("/{session_id}/events", response_model=EventList)
def list_events(
    session_id: str,
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    employer_id: int = Depends(require_dev_employer),
    db: DbSession = Depends(get_db),
) -> EventList:
    session = _employer_session(session_id, employer_id, db)
    total = db.scalar(
        select(func.count()).select_from(ActivityEvent).where(ActivityEvent.session_id == session.id)
    )
    rows = db.scalars(
        select(ActivityEvent)
        .where(ActivityEvent.session_id == session.id)
        .order_by(ActivityEvent.client_sequence, ActivityEvent.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return EventList(
        session_id=session.id,
        total_events=total,
        limit=limit,
        offset=offset,
        events=[
            EventOut(
                event_id=r.event_id,
                event_type=r.event_type,
                hostname=r.hostname,
                tab_id=r.tab_id,
                occurred_at=r.occurred_at,
                received_at=r.received_at,
                client_sequence=r.client_sequence,
                server_sequence=r.id,
            )
            for r in rows
        ],
    )
