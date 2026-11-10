def test_health_returns_expected_json(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "service": "vouch-backend"}


def test_health_is_the_only_non_docs_route(app):
    schema = app.openapi()
    assert list(schema["paths"]) == ["/health"]


def test_docs_page_is_served(client):
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
