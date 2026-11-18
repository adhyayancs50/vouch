"""Consent history and browser activity events (Milestone 5).

Privacy: events store only a normalized hostname and an optional tab ID. No full
URLs, paths, query strings, page titles, keystrokes or screenshots.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Enum, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime, utcnow
from app.monitoring.states import ConsentDecision, EventType


class ConsentRecord(Base):
    """Append-only log of every consent decision a candidate makes."""

    __tablename__ = "consent_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("session_candidates.id"), index=True)
    decision: Mapped[ConsentDecision] = mapped_column(Enum(ConsentDecision, native_enum=False, length=20))
    consent_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class ActivityEvent(Base):
    """One browser activity event. ``id`` doubles as the server receipt order."""

    __tablename__ = "activity_events"
    __table_args__ = (
        UniqueConstraint("candidate_id", "client_event_id", name="uq_event_client_id"),
        Index("ix_events_session_order", "session_id", "client_sequence", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[str] = mapped_column(String(40), unique=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("session_candidates.id"))
    client_event_id: Mapped[str] = mapped_column(String(64))
    event_type: Mapped[EventType] = mapped_column(Enum(EventType, native_enum=False, length=30))
    hostname: Mapped[str | None] = mapped_column(String(253), nullable=True)
    tab_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_sequence: Mapped[int] = mapped_column(BigInteger)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime())
    received_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
