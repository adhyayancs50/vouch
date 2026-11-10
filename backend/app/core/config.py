"""Application settings read from environment variables.

Every setting has a safe default so the app starts with no environment
configuration at all. See ``backend/.env.example`` for the variable names.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def _parse_origins(raw: str | None) -> tuple[str, ...]:
    """Parse a comma-separated origin list; fall back to the local dev defaults."""
    if raw is None or not raw.strip():
        return DEFAULT_CORS_ORIGINS
    origins = tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())
    if "*" in origins:
        raise ValueError("VOUCH_CORS_ORIGINS must list explicit origins; '*' is not allowed.")
    return origins or DEFAULT_CORS_ORIGINS


@dataclass(frozen=True)
class Settings:
    app_name: str = "vouch-backend"
    environment: str = "development"
    log_level: str = "INFO"
    cors_origins: tuple[str, ...] = field(default=DEFAULT_CORS_ORIGINS)


def get_settings() -> Settings:
    """Build settings from the current environment."""
    return Settings(
        environment=os.getenv("VOUCH_ENV", "development").strip() or "development",
        log_level=os.getenv("VOUCH_LOG_LEVEL", "INFO").strip().upper() or "INFO",
        cors_origins=_parse_origins(os.getenv("VOUCH_CORS_ORIGINS")),
    )
