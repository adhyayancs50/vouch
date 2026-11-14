"""Development-only access controls.

Production authentication does not exist yet. Until it does, every
unauthenticated route (``/api/dev/*`` and ``/api/sessions*``) is registered
only in development mode and only answers requests from this machine.
"""

from __future__ import annotations

import re
from ipaddress import ip_address

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.errors import ApiError
from app.db import get_db

DEV_EMPLOYER_HEADER = "X-Vouch-Dev-Employer"
_DEV_EMPLOYER_KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


def require_local_client(request: Request) -> None:
    """Reject anyone not on this machine, even if uvicorn is bound to 0.0.0.0."""
    host = request.client.host if request.client else None
    try:
        is_local = host is not None and ip_address(host).is_loopback
    except ValueError:
        is_local = host == "localhost"
    if not is_local:
        raise ApiError(403, "FORBIDDEN", "Development endpoints are local-only.")


def require_dev_employer(
    x_vouch_dev_employer: str | None = Header(default=None, alias=DEV_EMPLOYER_HEADER),
    db: DbSession = Depends(get_db),
) -> int:
    """Resolve the DEVELOPMENT employer identity from a header. Not authentication.

    Anyone on this machine can claim any employer key. This only separates test
    employers from each other until real employer accounts and login exist.
    Returns the internal employer id, creating the employer on first use.
    """
    from app.sessions.models import Employer

    key = (x_vouch_dev_employer or "").strip()
    if not key:
        raise ApiError(
            401,
            "DEV_EMPLOYER_REQUIRED",
            f"Send the {DEV_EMPLOYER_HEADER} header with a development employer key "
            "(employer login is not implemented yet).",
        )
    if not _DEV_EMPLOYER_KEY.fullmatch(key):
        raise ApiError(
            401,
            "DEV_EMPLOYER_INVALID",
            f"{DEV_EMPLOYER_HEADER} must be 1-64 characters: letters, digits, '.', '_' or '-'.",
        )

    employer = db.scalar(select(Employer).where(Employer.dev_key == key))
    if employer is None:
        employer = Employer(dev_key=key)
        db.add(employer)
        db.commit()
    return employer.id
