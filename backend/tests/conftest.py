from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def app():
    return create_app(Settings())


@pytest.fixture
def client(app):
    # raise_server_exceptions=False so the 500 handler's response is returned
    # to the test instead of the exception being re-raised.
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
