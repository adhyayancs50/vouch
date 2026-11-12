"""Router registration.

``/health`` lives at the root. Product endpoints from
docs/05-api-and-database-documentation.md will live under ``API_PREFIX``;
when the first one exists, add it with a single line in ``register_routers``:

    app.include_router(sessions.router, prefix=API_PREFIX)

Development-only routes (``/api/dev/...``) are registered only when
``settings.enable_dev_endpoints`` is true; otherwise they do not exist.
"""

from __future__ import annotations

from fastapi import FastAPI

from app.api.routes import health
from app.core.config import Settings

API_PREFIX = "/api"


def register_routers(app: FastAPI, settings: Settings) -> None:
    app.include_router(health.router)

    if settings.enable_dev_endpoints:
        from app.dev import events as dev_events

        app.state.dev_event_store = dev_events.DevEventStore()
        app.include_router(dev_events.router, prefix=API_PREFIX)
