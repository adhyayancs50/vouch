"""Router registration.

``/health`` lives at the root. Product endpoints from
docs/05-api-and-database-documentation.md will live under ``API_PREFIX``;
when the first one exists, add it with a single line in ``register_routers``:

    app.include_router(sessions.router, prefix=API_PREFIX)
"""

from __future__ import annotations

from fastapi import FastAPI

from app.api.routes import health

API_PREFIX = "/api"


def register_routers(app: FastAPI) -> None:
    app.include_router(health.router)
