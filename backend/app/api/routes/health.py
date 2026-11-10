"""Liveness check. Touches no external resources."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["healthy"]
    service: Literal["vouch-backend"]


@router.get("/health", response_model=HealthResponse, summary="Service health check")
def health() -> HealthResponse:
    return HealthResponse(status="healthy", service="vouch-backend")
