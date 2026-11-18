"""Consent and monitoring states (Milestone 5). See backend/API_MONITORING.md."""

from __future__ import annotations

import enum


class ConsentStatus(str, enum.Enum):
    """Current consent of the candidate. NONE until they make an explicit decision."""

    NONE = "NONE"
    GRANTED = "GRANTED"
    DECLINED = "DECLINED"
    WITHDRAWN = "WITHDRAWN"


class ConsentDecision(str, enum.Enum):
    """What a candidate can send to POST /consent."""

    GRANTED = "GRANTED"
    DECLINED = "DECLINED"
    WITHDRAWN = "WITHDRAWN"


class MonitoringStatus(str, enum.Enum):
    """Browser-activity monitoring for one candidate. STOPPED is final."""

    NOT_STARTED = "NOT_STARTED"
    ACTIVE = "ACTIVE"
    STOPPED = "STOPPED"


class StopReason(str, enum.Enum):
    CANDIDATE_STOPPED = "CANDIDATE_STOPPED"
    CONSENT_WITHDRAWN = "CONSENT_WITHDRAWN"


class EventType(str, enum.Enum):
    """Event names from docs/05 API 5.1. Only these two are accepted in Milestone 5."""

    TAB_SWITCH = "TAB_SWITCH"
    WEBSITE_NAVIGATION = "WEBSITE_NAVIGATION"
