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


LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


@pytest.mark.parametrize("origin", LOCAL_ORIGINS)
def test_actual_get_from_local_frontend_is_readable(client, origin):
    response = client.get("/health", headers={"Origin": origin})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.json() == {"status": "healthy", "service": "vouch-backend"}


@pytest.mark.parametrize("origin", LOCAL_ORIGINS)
def test_preflight_allows_json_content_type(client, origin):
    response = client.options(
        "/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type, authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("origin", LOCAL_ORIGINS)
def test_error_responses_carry_cors_headers(app, client, origin):
    """The frontend must be able to read error bodies, including 500s."""
    from pydantic import BaseModel

    class Payload(BaseModel):
        count: int

    @app.post("/_test/validate")
    def _validate(payload: Payload):
        return {"ok": True}

    @app.get("/_test/boom")
    def _boom():
        raise RuntimeError("internal detail")

    headers = {"Origin": origin}
    not_found = client.get("/does-not-exist", headers=headers)
    invalid = client.post("/_test/validate", json={"count": "x"}, headers=headers)
    crashed = client.get("/_test/boom", headers=headers)

    for response, status, code in (
        (not_found, 404, "NOT_FOUND"),
        (invalid, 422, "VALIDATION_ERROR"),
        (crashed, 500, "INTERNAL_ERROR"),
    ):
        assert response.status_code == status
        assert response.json()["error"]["code"] == code
        assert response.headers.get("access-control-allow-origin") == origin
    assert "internal detail" not in crashed.text


def test_origin_parsing():
    assert _parse_origins(None) == DEFAULT_CORS_ORIGINS
    assert _parse_origins("  ") == DEFAULT_CORS_ORIGINS
    assert _parse_origins("http://a.test, http://b.test/") == ("http://a.test", "http://b.test")
    with pytest.raises(ValueError):
        _parse_origins("*")
