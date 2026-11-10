import pytest

from app.core.config import DEFAULT_CORS_ORIGINS, _parse_origins


def _preflight(client, origin):
    return client.options(
        "/health",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_preflight_allowed_for_local_frontend(client, origin):
    response = _preflight(client, origin)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_preflight_rejected_for_unknown_origin(client):
    response = _preflight(client, "http://evil.example")
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_simple_request_from_unknown_origin_gets_no_cors_header(client):
    response = client.get("/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_origin_parsing():
    assert _parse_origins(None) == DEFAULT_CORS_ORIGINS
    assert _parse_origins("  ") == DEFAULT_CORS_ORIGINS
    assert _parse_origins("http://a.test, http://b.test/") == ("http://a.test", "http://b.test")
    with pytest.raises(ValueError):
        _parse_origins("*")
