"""Request and response bodies for consent, monitoring and events (backend/API_MONITORING.md)."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from app.monitoring.states import (
    ConsentDecision,
    ConsentStatus,
    EventType,
    MonitoringStatus,
    StopReason,
)
from app.sessions.schemas import CandidateOut, PolicyOut
from app.sessions.models import SessionStatus

_VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
_CLIENT_EVENT_ID = re.compile(r"[A-Za-z0-9_-]{8,64}")
_LABEL = r"(?!-)[a-z0-9-]{1,63}(?<!-)"
_HOSTNAME = re.compile(rf"(?=.{{1,253}}$){_LABEL}(\.{_LABEL})*")
_IPV4 = re.compile(r"(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}")
_NOT_A_HOSTNAME = set("/:?#@ \t\\%")


# --- consent ----------------------------------------------------------------


class ConsentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    decision: ConsentDecision
    # Required to GRANT; must equal the server's required_consent_version.
    consent_version: str | None = None

    @field_validator("consent_version")
    @classmethod
    def _version_format(cls, value: str | None) -> str | None:
        if value is not None and not _VERSION.fullmatch(value):
            raise ValueError("must be 1-64 characters: letters, digits, '.', '_' or '-'")
        return value

    @model_validator(mode="after")
    def _grant_needs_version(self) -> ConsentRequest:
        if self.decision is ConsentDecision.GRANTED and not self.consent_version:
            raise ValueError("consent_version is required when decision is GRANTED")
        return self


class ConsentState(BaseModel):
    status: ConsentStatus
    consent_version: str | None
    updated_at: datetime | None
    required_version: str


class MonitoringState(BaseModel):
    status: MonitoringStatus
    started_at: datetime | None
    stopped_at: datetime | None
    stop_reason: StopReason | None
    events_received: int


class CandidateState(BaseModel):
    """What the extension sees about its own session (GET .../candidate)."""

    session_id: str
    candidate_id: str
    title: str
    policy: PolicyOut
    consent: ConsentState
    monitoring: MonitoringState
    candidate_token_expires_at: datetime


class CandidateStateChange(CandidateState):
    """Response to consent/start/stop. ``changed`` is false when the call was a repeat."""

    changed: bool


# --- events -----------------------------------------------------------------


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # Client-generated unique ID (e.g. crypto.randomUUID()); used to drop retried duplicates.
    client_event_id: str
    event_type: EventType
    # When it happened, by the browser clock (UTC).
    occurred_at: datetime
    # Counter the extension increments for every event in this session (0, 1, 2, ...).
    client_sequence: StrictInt = Field(ge=0, le=2**53)
    hostname: str | None = None
    tab_id: StrictInt | None = Field(default=None, ge=0, le=2**31 - 1)

    @field_validator("client_event_id")
    @classmethod
    def _client_event_id(cls, value: str) -> str:
        if not _CLIENT_EVENT_ID.fullmatch(value):
            raise ValueError("must be 8-64 characters: letters, digits, '-' or '_'")
        return value

    @field_validator("occurred_at", mode="before")
    @classmethod
    def _utc_iso(cls, value: Any) -> datetime:
        if not isinstance(value, str):
            raise ValueError("must be an ISO 8601 UTC string, e.g. 2026-11-18T20:30:00.000Z")
        try:
            parsed = datetime.fromisoformat(value.strip())
        except ValueError as exc:
            raise ValueError("must be an ISO 8601 UTC string, e.g. 2026-11-18T20:30:00.000Z") from exc
        if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(None):
            raise ValueError("must be in UTC (end with 'Z' or '+00:00')")
        return parsed.astimezone(timezone.utc)

    @field_validator("hostname")
    @classmethod
    def _hostname(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if any(ch in _NOT_A_HOSTNAME for ch in value):
            raise ValueError(
                "must be a bare hostname like chatgpt.com: no scheme, port, path, query or credentials"
            )
        host = value.lower().rstrip(".")
        if not (_IPV4.fullmatch(host) or _HOSTNAME.fullmatch(host)):
            raise ValueError("must be a valid hostname like chatgpt.com")
        return host

    @model_validator(mode="after")
    def _hostname_rules(self) -> EventIn:
        if self.event_type is EventType.WEBSITE_NAVIGATION and self.hostname is None:
            raise ValueError("hostname is required for WEBSITE_NAVIGATION")
        return self

    def same_content(self, other: Any) -> bool:
        return (
            self.event_type == other.event_type
            and self.occurred_at == other.occurred_at
            and self.client_sequence == other.client_sequence
            and self.hostname == other.hostname
            and self.tab_id == other.tab_id
        )


class EventBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The upper bound is checked against settings.max_events_per_request in the route.
    events: list[EventIn] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_ids(self) -> EventBatch:
        ids = [e.client_event_id for e in self.events]
        if len(ids) != len(set(ids)):
            raise ValueError("each client_event_id may appear only once per request")
        return self


class EventResult(BaseModel):
    client_event_id: str
    event_id: str
    status: Literal["STORED", "DUPLICATE"]


class EventBatchResult(BaseModel):
    stored: int
    duplicates: int
    results: list[EventResult]


# --- employer views ----------------------------------------------------------


class ConsentHistoryEntry(BaseModel):
    decision: ConsentDecision
    consent_version: str | None
    recorded_at: datetime


class EmployerConsentView(BaseModel):
    status: ConsentStatus
    consent_version: str | None
    updated_at: datetime | None
    history: list[ConsentHistoryEntry]


class EmployerMonitoringState(MonitoringState):
    last_event_received_at: datetime | None


class EmployerMonitoringView(BaseModel):
    session_id: str
    session_status: SessionStatus
    candidate: CandidateOut | None
    consent: EmployerConsentView
    monitoring: EmployerMonitoringState


class EventOut(BaseModel):
    event_id: str
    event_type: EventType
    hostname: str | None
    tab_id: int | None
    occurred_at: datetime
    received_at: datetime
    client_sequence: int
    server_sequence: int


class EventList(BaseModel):
    session_id: str
    total_events: int
    limit: int
    offset: int
    events: list[EventOut]
