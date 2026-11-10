"""Error responses follow docs/05 §7: {"error": {"code", "message"}}.

The 422 and 500 cases use routes registered only on the test app instance;
no such routes exist in the production app.
"""

from pydantic import BaseModel

SECRET = "super-secret-internal-detail /home/app/secrets.py"


def _assert_error_shape(body, code):
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]


def test_unknown_route_returns_404_error_shape(client):
    response = client.get("/does-not-exist")
    assert response.status_code == 404
    _assert_error_shape(response.json(), "NOT_FOUND")


def test_wrong_method_returns_405_error_shape(client):
    response = client.post("/health")
    assert response.status_code == 405
    _assert_error_shape(response.json(), "METHOD_NOT_ALLOWED")


def test_validation_failure_returns_422_error_shape(app, client):
    class Payload(BaseModel):
        count: int

    @app.post("/_test/validate")
    def _validate(payload: Payload):
        return {"ok": True}

    response = client.post("/_test/validate", json={"count": "not-a-number-" + SECRET})
    assert response.status_code == 422
    body = response.json()
    _assert_error_shape(body, "VALIDATION_ERROR")
    assert body["error"]["details"][0]["location"] == "body.count"
    # Submitted input must not be echoed back.
    assert SECRET not in response.text


def test_unhandled_exception_returns_generic_500(app, client, caplog):
    @app.get("/_test/boom")
    def _boom():
        raise RuntimeError(SECRET)

    response = client.get("/_test/boom")
    assert response.status_code == 500
    _assert_error_shape(response.json(), "INTERNAL_ERROR")
    assert SECRET not in response.text
    assert "Traceback" not in response.text
    # ...but it is logged server-side.
    assert SECRET in caplog.text
