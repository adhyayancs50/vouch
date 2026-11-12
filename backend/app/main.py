"""Vouch backend entry point.

Run from ``backend/``:

    uvicorn app.main:app --reload
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import register_routers
from app.core.config import Settings, get_settings
from app.core.errors import UnhandledErrorMiddleware, register_exception_handlers


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level)

    app = FastAPI(
        title="Vouch Backend",
        description="Privacy-first interview verification system — backend API.",
        version="0.1.0",
    )
    app.state.settings = settings

    # Order matters: the last middleware added is the outermost. Adding the
    # error middleware first keeps it inside CORS, so 500s carry CORS headers.
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(
        CORSMiddleware,
        # Frontend origins, plus explicit chrome-extension:// origins in dev mode only.
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    register_exception_handlers(app)
    register_routers(app, settings)
    if settings.enable_dev_endpoints:
        logging.getLogger("vouch").warning(
            "Development endpoints are ENABLED (/api/dev/*). Local development only."
        )
    return app


app = create_app()
