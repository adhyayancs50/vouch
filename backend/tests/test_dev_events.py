"""Development-only test event endpoints: POST/GET /api/dev/events."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, _parse_bool, _parse_extension_origins, get_settings
from app.main import create_app

EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
LOCAL_CLIENT = ("127.0.0.1", 50000)


def valid_event(**overrides):
    event = {
        "session_id": "dev-session-1",
        "event_type": "EXTENSION_CONNECTED",
        "timestamp": "2026-11-12T20:30:00Z",
        "metadata": {"extension_version": "0.1.0"},
    }
    event.update(overrides)
    return event


@pytest.fixture
def dev_settings():
    return Settings(enable_dev_endpoints=True, extension_origins=(EXT_ORIGIN,))


@pytest.fixture
def dev_client(dev_settings):
    with TestClient(create_app(dev_settings), client=LOCAL_CLIENT) as c:
        yield c


# --- valid events -----------------------------------------------------------


def test_post_valid_event_returns_ack(dev_client):
    response = dev_client.post("/api/dev/events", json=valid_event())
    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    assert body["session_id"] == "dev-session-1"
    assert body["event_id"].startswith("evt_") and len(body["event_id"]) == 36
    assert body["message"]


def test_each_event_gets_a_unique_id(dev_client):
    ids = {dev_client.post("/api/dev/events", json=valid_event()).json()["event_id"] for _ in range(5)}
    assert len(ids) == 5


@pytest.mark.parametrize("ts", ["2026-11-12T20:30:00Z", "2026-11-12T20:30:00.123+00:00"])
def test_utc_timestamp_forms_accepted(dev_client, ts):
    assert dev_client.post("/api/dev/events", json=valid_event(timestamp=ts)).status_code == 201


def test_empty_metadata_object_accepted(dev_client):
    assert dev_client.post("/api/dev/events", json=valid_event(metadata={})).status_code == 201


# --- invalid payloads -------------------------------------------------------


@pytest.mark.parametrize("field", ["session_id", "event_type", "timestamp", "metadata"])
def test_missing_required_field_rejected(dev_client, field):
    payload = valid_event()
    del payload[field]
    response = dev_client.post("/api/dev/events", json=payload)
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert any(d["location"] == f"body.{field}" for d in body["error"]["details"])


@pytest.mark.parametrize(
    "overrides",
    [
        {"event_type": "TAB_SWITCH"},  # not supported in this milestone
        {"event_type": "extension_connected"},
        {"timestamp": "2026-11-12 20:30"},  # no timezone
        {"timestamp": "2026-11-12T20:30:00"},  # naive
        {"timestamp": "2026-11-12T15:30:00-05:00"},  # not UTC
        {"timestamp": "not-a-date"},
        {"timestamp": 1794515400},  # unix number, not ISO 8601
        {"session_id": ""},
        {"session_id": "   "},
        {"session_id": "x" * 129},
        {"metadata": "not-an-object"},
        {"metadata": ["a", "b"]},
        {"metadata": {"blob": "x" * 5000}},  # over 4 KB
    ],
)
def test_invalid_values_rejected(dev_client, overrides):
    response = dev_client.post("/api/dev/events", json=valid_event(**overrides))
    assert response.status_code == 422, overrides
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_unknown_top_level_field_rejected(dev_client):
    response = dev_client.post("/api/dev/events", json=valid_event(url="https://example.com"))
    assert response.status_code == 422


def test_non_json_body_rejected(dev_client):
    response = dev_client.post(
        "/api/dev/events", content=b"hello", headers={"Content-Type": "text/plain"}
    )
    assert response.status_code == 422


def test_rejected_events_are_not_stored(dev_client):
    dev_client.post("/api/dev/events", json=valid_event(event_type="TAB_SWITCH"))
    assert dev_client.get("/api/dev/events").json()["total_events"] == 0


# --- retrieval --------------------------------------------------------------


def test_get_returns_stored_events_chronologically(dev_client):
    later = dev_client.post(
        "/api/dev/events", json=valid_event(session_id="b", timestamp="2026-11-12T20:31:00Z")
    ).json()
    earlier = dev_client.post(
        "/api/dev/events",
        json=valid_event(session_id="a", timestamp="2026-11-12T20:30:00Z", metadata={"k": 1}),
    ).json()

    response = dev_client.get("/api/dev/events")
    assert response.status_code == 200
    body = response.json()
    assert body["total_events"] == 2
    assert [e["event_id"] for e in body["events"]] == [earlier["event_id"], later["event_id"]]
    first = body["events"][0]
    assert first == {
        "session_id": "a",
        "event_type": "EXTENSION_CONNECTED",
        "timestamp": "2026-11-12T20:30:00Z",
        "metadata": {"k": 1},
        "event_id": earlier["event_id"],
        "received_at": first["received_at"],
    }
    assert first["received_at"].endswith("Z")


def test_get_when_empty(dev_client):
    assert dev_client.get("/api/dev/events").json() == {"total_events": 0, "events": []}


def test_store_is_per_app_instance(dev_settings):
    with TestClient(create_app(dev_settings), client=LOCAL_CLIENT) as one:
        one.post("/api/dev/events", json=valid_event())
    with TestClient(create_app(dev_settings), client=LOCAL_CLIENT) as two:
        assert two.get("/api/dev/events").json()["total_events"] == 0


def test_store_is_bounded():
    from app.dev.events import DevEventIn, DevEventStore

    store = DevEventStore(max_events=3)
    for i in range(5):
        store.add(DevEventIn(**valid_event(session_id=f"s{i}")))
    assert [e.session_id for e in store.list()] == ["s2", "s3", "s4"]


# --- disabled by default / local only --------------------------------------


def test_dev_endpoints_absent_by_default():
    with TestClient(create_app(Settings()), client=LOCAL_CLIENT) as c:
        assert c.post("/api/dev/events", json=valid_event()).status_code == 404
        assert c.get("/api/dev/events").status_code == 404
        assert "/api/dev/events" not in c.app.openapi()["paths"]


def test_dev_endpoints_reject_non_local_clients(dev_settings):
    with TestClient(create_app(dev_settings), client=("203.0.113.7", 50000)) as c:
        response = c.post("/api/dev/events", json=valid_event())
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
        assert c.get("/api/dev/events").status_code == 403


@pytest.mark.parametrize("host", ["127.0.0.1", "::1", "localhost"])
def test_loopback_clients_allowed(dev_settings, host):
    with TestClient(create_app(dev_settings), client=(host, 50000)) as c:
        assert c.get("/api/dev/events").status_code == 200


def test_dev_endpoints_cannot_be_enabled_outside_development():
    with pytest.raises(ValueError, match="only allowed when VOUCH_ENV=development"):
        Settings(environment="production", enable_dev_endpoints=True)


def test_extension_origins_require_dev_mode():
    with pytest.raises(ValueError, match="requires"):
        Settings(extension_origins=(EXT_ORIGIN,))


def test_env_vars_enable_dev_mode(monkeypatch):
    monkeypatch.setenv("VOUCH_ENABLE_DEV_ENDPOINTS", "true")
    monkeypatch.setenv("VOUCH_EXTENSION_ORIGINS", EXT_ORIGIN)
    settings = get_settings()
    assert settings.enable_dev_endpoints is True
    assert EXT_ORIGIN in settings.allowed_origins

    monkeypatch.setenv("VOUCH_ENV", "production")
    with pytest.raises(ValueError):
        get_settings()


def test_config_parsing():
    assert _parse_bool("X", None) is False
    assert _parse_bool("X", "TRUE") is True
    with pytest.raises(ValueError):
        _parse_bool("X", "maybe")
    assert _parse_extension_origins(f" {EXT_ORIGIN}/ ") == (EXT_ORIGIN,)
    for bad in ["chrome-extension://*", "chrome-extension://short", "http://localhost:5173"]:
        with pytest.raises(ValueError):
            _parse_extension_origins(bad)


# --- CORS for the extension and frontend ------------------------------------


def test_extension_origin_preflight_and_post_allowed(dev_client):
    preflight = dev_client.options(
        "/api/dev/events",
        headers={
            "Origin": EXT_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == EXT_ORIGIN

    post = dev_client.post("/api/dev/events", json=valid_event(), headers={"Origin": EXT_ORIGIN})
    assert post.status_code == 201
    assert post.headers["access-control-allow-origin"] == EXT_ORIGIN


def test_unlisted_extension_origin_not_allowed(dev_client):
    other = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba"
    preflight = dev_client.options(
        "/api/dev/events",
        headers={"Origin": other, "Access-Control-Request-Method": "POST"},
    )
    assert preflight.status_code == 400
    assert "access-control-allow-origin" not in preflight.headers


def test_extension_origin_not_allowed_when_dev_mode_off(client):
    response = client.get("/health", headers={"Origin": EXT_ORIGIN})
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_frontend_cors_and_health_unchanged_in_dev_mode(dev_client, origin):
    response = dev_client.get("/health", headers={"Origin": origin})
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "service": "vouch-backend"}
    assert response.headers["access-control-allow-origin"] == origin
