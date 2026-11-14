"""Development-only test event intake for the Chrome extension (Milestone 3).

``POST /api/dev/events`` stores a validated test event in memory and
``GET /api/dev/events`` lists them. This is NOT the product event API from
docs/05 (``/api/sessions/{id}/events``): there is no session lookup, no
candidate token, and nothing is persisted. Events disappear on restart.

The router is only registered when ``VOUCH_ENABLE_DEV_ENDPOINTS=true`` and
``VOUCH_ENV=development`` (see app/core/config.py), and every request must
come from the local machine.
"""

from __future__ import annotations

import json
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.access import require_local_client

MAX_STORED_EVENTS = 1000
MAX_METADATA_BYTES = 4096

SupportedDevEventType = Literal["EXTENSION_CONNECTED"]


router = APIRouter(
    prefix="/dev",
    tags=["development"],
    dependencies=[Depends(require_local_client)],
)


class DevEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    session_id: str = Field(min_length=1, max_length=128)
    event_type: SupportedDevEventType
    timestamp: datetime
    metadata: dict[str, Any]

    @field_validator("timestamp", mode="before")
    @classmethod
    def _iso8601_utc(cls, value: Any) -> datetime:
        if not isinstance(value, str):
            raise ValueError("must be an ISO 8601 UTC string, e.g. 2026-11-12T20:30:00Z")
        try:
            parsed = datetime.fromisoformat(value.strip())
        except ValueError as exc:
            raise ValueError("must be an ISO 8601 UTC string, e.g. 2026-11-12T20:30:00Z") from exc
        if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(None):
            raise ValueError("must be in UTC (end with 'Z' or '+00:00')")
        return parsed.astimezone(timezone.utc)

    @field_validator("metadata")
    @classmethod
    def _small_metadata(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value, separators=(",", ":"))) > MAX_METADATA_BYTES:
            raise ValueError(f"must be at most {MAX_METADATA_BYTES} bytes as JSON")
        return value


class DevEvent(BaseModel):
    """A stored event. Input rules live on DevEventIn; this is server-built data."""

    event_id: str
    session_id: str
    event_type: SupportedDevEventType
    timestamp: datetime
    received_at: datetime
    metadata: dict[str, Any]


class DevEventAck(BaseModel):
    success: Literal[True] = True
    event_id: str
    session_id: str
    message: str = "Development test event stored."


class DevEventList(BaseModel):
    total_events: int
    events: list[DevEvent]


class DevEventStore:
    """Thread-safe, bounded, in-memory store. Oldest events drop past the limit."""

    def __init__(self, max_events: int = MAX_STORED_EVENTS) -> None:
        self._events: deque[DevEvent] = deque(maxlen=max_events)
        self._lock = threading.Lock()

    def add(self, event: DevEventIn) -> DevEvent:
        stored = DevEvent(
            **event.model_dump(),
            event_id=f"evt_{uuid.uuid4().hex}",
            received_at=datetime.now(timezone.utc),
        )
        with self._lock:
            self._events.append(stored)
        return stored

    def list(self) -> list[DevEvent]:
        with self._lock:
            events = list(self._events)
        return sorted(events, key=lambda e: (e.timestamp, e.received_at))


def get_store(request: Request) -> DevEventStore:
    return request.app.state.dev_event_store


@router.post("/events", status_code=201, response_model=DevEventAck)
def create_dev_event(payload: DevEventIn, store: DevEventStore = Depends(get_store)) -> DevEventAck:
    stored = store.add(payload)
    return DevEventAck(event_id=stored.event_id, session_id=stored.session_id)


@router.get("/events", response_model=DevEventList)
def list_dev_events(store: DevEventStore = Depends(get_store)) -> DevEventList:
    events = store.list()
    return DevEventList(total_events=len(events), events=events)
