"""Request and response bodies for the session API (contract: backend/API_SESSIONS.md)."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.sessions.models import AiUsage, SessionStatus

MAX_DOMAINS = 50
_HOSTNAME = re.compile(
    r"(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+"
)


def _normalize_domains(values: list[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        host = value.strip().lower().rstrip(".")
        if host.startswith("www."):
            host = host[4:]
        if not _HOSTNAME.fullmatch(host):
            raise ValueError(
                f"{value!r} is not a domain; use a bare hostname like chatgpt.com "
                "(no https://, path or port)"
            )
        if host not in seen:
            seen.append(host)
    return seen


class PolicyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ai_usage: AiUsage
    allowed_domains: list[str] = Field(default_factory=list, max_length=MAX_DOMAINS)
    restricted_domains: list[str] = Field(default_factory=list, max_length=MAX_DOMAINS)

    @field_validator("allowed_domains", "restricted_domains")
    @classmethod
    def _domains(cls, value: list[str]) -> list[str]:
        return _normalize_domains(value)

    @model_validator(mode="after")
    def _no_overlap(self) -> PolicyIn:
        overlap = set(self.allowed_domains) & set(self.restricted_domains)
        if overlap:
            raise ValueError(
                "a domain cannot be both allowed and restricted: " + ", ".join(sorted(overlap))
            )
        return self


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=200)
    candidate_name: str | None = Field(default=None, min_length=1, max_length=120)
    policy: PolicyIn


class PolicyOut(BaseModel):
    ai_usage: AiUsage
    allowed_domains: list[str]
    restricted_domains: list[str]


class CandidateOut(BaseModel):
    candidate_id: str
    name: str | None
    joined_at: datetime


class SessionOut(BaseModel):
    session_id: str
    title: str
    candidate_name: str | None
    status: SessionStatus
    policy: PolicyOut
    created_at: datetime
    join_code_expires_at: datetime
    joined_at: datetime | None
    candidate: CandidateOut | None


class SessionCreated(SessionOut):
    # Plaintext join code. Returned ONLY here, once; the server keeps a hash.
    candidate_join_code: str


class SessionList(BaseModel):
    total_sessions: int
    sessions: list[SessionOut]


class JoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    join_code: str = Field(min_length=1, max_length=64)
    # Optional development candidate name; defaults to the session's candidate_name.
    candidate_name: str | None = Field(default=None, min_length=1, max_length=120)


class JoinResponse(BaseModel):
    success: Literal[True] = True
    session_id: str
    title: str
    status: SessionStatus
    policy: PolicyOut
    candidate_id: str
    candidate_name: str | None
    joined_at: datetime
