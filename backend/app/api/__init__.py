"""Router registration.

``/health`` lives at the root. Everything else lives under ``API_PREFIX``.

Development mode (``settings.enable_dev_endpoints``) registers:
- ``/api/dev/events``: in-memory extension test events (Milestone 3)
- ``/api/sessions``: interview sessions in SQLite (Milestone 4)

Without it those routes do not exist (404). They have no production
authentication yet, so they must not be enabled outside local development.
"""

from __future__ import annotations

from fastapi import FastAPI

from app.api.routes import health
from app.core.config import Settings

API_PREFIX = "/api"


def register_routers(app: FastAPI, settings: Settings) -> None:
    app.include_router(health.router)

    if settings.enable_dev_endpoints:
        from app.db import create_db_engine, init_db
        from app.dev import events as dev_events
        from app.sessions import routes as session_routes
        from app.sessions.join_codes import JoinAttemptLimiter

        app.state.dev_event_store = dev_events.DevEventStore()
        app.include_router(dev_events.router, prefix=API_PREFIX)

        app.state.db_engine = create_db_engine(settings.resolved_database_url)
        app.state.db_sessionmaker = init_db(app.state.db_engine)
        app.state.join_limiter = JoinAttemptLimiter(
            settings.join_max_failed_attempts, settings.join_attempt_window_seconds
        )
        app.include_router(session_routes.router, prefix=API_PREFIX)
