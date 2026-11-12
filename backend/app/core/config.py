"""Application settings read from environment variables.

Every setting has a safe default so the app starts with no environment
configuration at all. See ``backend/.env.example`` for the variable names.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)

# Chrome extension IDs are exactly 32 characters in the range a-p.
_EXTENSION_ORIGIN = re.compile(r"chrome-extension://[a-p]{32}")

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"", "0", "false", "no", "off"}


def _parse_origins(raw: str | None) -> tuple[str, ...]:
    """Parse a comma-separated origin list; fall back to the local dev defaults."""
    if raw is None or not raw.strip():
        return DEFAULT_CORS_ORIGINS
    origins = tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())
    if "*" in origins:
        raise ValueError("VOUCH_CORS_ORIGINS must list explicit origins; '*' is not allowed.")
    return origins or DEFAULT_CORS_ORIGINS


def _parse_extension_origins(raw: str | None) -> tuple[str, ...]:
    """Parse explicit ``chrome-extension://<id>`` origins. Wildcards are rejected."""
    if raw is None or not raw.strip():
        return ()
    origins = tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())
    for origin in origins:
        if not _EXTENSION_ORIGIN.fullmatch(origin):
            raise ValueError(
                "VOUCH_EXTENSION_ORIGINS entries must be exact Chrome extension origins "
                f"like chrome-extension://<32-letter id>; got {origin!r}."
            )
    return origins


def _parse_bool(name: str, raw: str | None) -> bool:
    value = (raw or "").strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ValueError(f"{name} must be true or false; got {raw!r}.")


@dataclass(frozen=True)
class Settings:
    app_name: str = "vouch-backend"
    environment: str = "development"
    log_level: str = "INFO"
    cors_origins: tuple[str, ...] = field(default=DEFAULT_CORS_ORIGINS)
    # Development-only test endpoints (POST/GET /api/dev/events). Off by default.
    enable_dev_endpoints: bool = False
    # Exact chrome-extension:// origins allowed by CORS, only while dev endpoints are on.
    extension_origins: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.enable_dev_endpoints and self.environment != "development":
            raise ValueError(
                "VOUCH_ENABLE_DEV_ENDPOINTS=true is only allowed when VOUCH_ENV=development "
                f"(current VOUCH_ENV={self.environment!r})."
            )
        if self.extension_origins and not self.enable_dev_endpoints:
            raise ValueError(
                "VOUCH_EXTENSION_ORIGINS is a development setting; it requires "
                "VOUCH_ENABLE_DEV_ENDPOINTS=true."
            )

    @property
    def allowed_origins(self) -> tuple[str, ...]:
        """All CORS origins: the frontend, plus extension origins in dev mode."""
        if not self.enable_dev_endpoints:
            return self.cors_origins
        return self.cors_origins + tuple(
            o for o in self.extension_origins if o not in self.cors_origins
        )


def get_settings() -> Settings:
    """Build settings from the current environment."""
    return Settings(
        environment=os.getenv("VOUCH_ENV", "development").strip() or "development",
        log_level=os.getenv("VOUCH_LOG_LEVEL", "INFO").strip().upper() or "INFO",
        cors_origins=_parse_origins(os.getenv("VOUCH_CORS_ORIGINS")),
        enable_dev_endpoints=_parse_bool(
            "VOUCH_ENABLE_DEV_ENDPOINTS", os.getenv("VOUCH_ENABLE_DEV_ENDPOINTS")
        ),
        extension_origins=_parse_extension_origins(os.getenv("VOUCH_EXTENSION_ORIGINS")),
    )
