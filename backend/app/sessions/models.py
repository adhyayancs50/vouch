"""Database tables for employers, interview sessions and candidates.

Follows docs/05 Part B. Differences for the development MVP:
- ``employers`` holds a development key instead of email/password (no login yet).
- ``session_candidates`` records the development candidate who joined.
- ``join_code_hash`` is a SHA-256 hex digest; the plaintext code is never stored.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import JSON, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTime, utcnow


class SessionStatus(str, enum.Enum):
    CREATED = "CREATED"
    JOINED = "JOINED"


class AiUsage(str, enum.Enum):
    PROHIBITED = "PROHIBITED"
    PARTIALLY_ALLOWED = "PARTIALLY_ALLOWED"
    ALLOWED = "ALLOWED"


class Employer(Base):
    __tablename__ = "employers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Development identity from the X-Vouch-Dev-Employer header. Not a credential.
    dev_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class InterviewSession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    employer_id: Mapped[int] = mapped_column(ForeignKey("employers.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    candidate_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ai_usage: Mapped[AiUsage] = mapped_column(Enum(AiUsage, native_enum=False, length=20))
    allowed_domains: Mapped[list[str]] = mapped_column(JSON, default=list)
    restricted_domains: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, native_enum=False, length=20), default=SessionStatus.CREATED
    )
    join_code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    join_code_expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    joined_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    candidate: Mapped[SessionCandidate | None] = relationship(
        back_populates="session", uselist=False, lazy="selectin"
    )


class SessionCandidate(Base):
    """The development candidate who joined a session (one per session)."""

    __tablename__ = "session_candidates"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    session: Mapped[InterviewSession] = relationship(back_populates="candidate")
