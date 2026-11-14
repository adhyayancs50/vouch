"""Interview sessions and candidate join codes: /api/sessions (development mode)."""

from __future__ import annotations

import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.sessions import join_codes

LOCAL = ("127.0.0.1", 50000)
EMPLOYER = {"X-Vouch-Dev-Employer": "acme-hr"}
OTHER_EMPLOYER = {"X-Vouch-Dev-Employer": "globex"}
CODE_FORMAT = re.compile(r"^[A-HJKMNP-TV-Z2-9]{4}(-[A-HJKMNP-TV-Z2-9]{4}){3}$")


def new_session(**overrides):
    body = {
        "title": "Software Engineering Interview",
        "candidate_name": "Jordan Lee",
        "policy": {
            "ai_usage": "PROHIBITED",
            "allowed_domains": [],
            "restricted_domains": ["chatgpt.com", "claude.ai"],
        },
    }
    body.update(overrides)
    return body


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "sessions.db"


@pytest.fixture
def settings(db_path):
    return Settings(enable_dev_endpoints=True, database_url=f"sqlite:///{db_path}")


@pytest.fixture
def api(settings):
    with TestClient(create_app(settings), client=LOCAL) as c:
        yield c


def create(api, headers=EMPLOYER, **overrides):
    response = api.post("/api/sessions", json=new_session(**overrides), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def expire(db_path, session_id):
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).replace(tzinfo=None)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE sessions SET join_code_expires_at = ? WHERE id = ?",
            (past.isoformat(sep=" "), session_id),
        )


# --- creation ---------------------------------------------------------------


def test_create_session_returns_details_and_one_time_join_code(api):
    body = create(api)
    assert body["session_id"].startswith("sess_") and len(body["session_id"]) == 37
    assert body["title"] == "Software Engineering Interview"
    assert body["candidate_name"] == "Jordan Lee"
    assert body["status"] == "CREATED"
    assert body["policy"] == {
        "ai_usage": "PROHIBITED",
        "allowed_domains": [],
        "restricted_domains": ["chatgpt.com", "claude.ai"],
    }
    assert CODE_FORMAT.match(body["candidate_join_code"])
    assert body["joined_at"] is None and body["candidate"] is None
    created = datetime.fromisoformat(body["created_at"])
    expires = datetime.fromisoformat(body["join_code_expires_at"])
    assert body["created_at"].endswith("Z") and body["join_code_expires_at"].endswith("Z")
    assert expires - created == timedelta(hours=72)


@pytest.mark.parametrize("ai_usage", ["PROHIBITED", "PARTIALLY_ALLOWED", "ALLOWED"])
def test_all_policy_values_accepted(api, ai_usage):
    body = create(api, policy={"ai_usage": ai_usage})
    assert body["policy"] == {"ai_usage": ai_usage, "allowed_domains": [], "restricted_domains": []}


def test_candidate_name_is_optional(api):
    body = new_session()
    del body["candidate_name"]
    response = api.post("/api/sessions", json=body, headers=EMPLOYER)
    assert response.status_code == 201
    assert response.json()["candidate_name"] is None


def test_domains_are_normalized(api):
    body = create(
        api,
        policy={
            "ai_usage": "PARTIALLY_ALLOWED",
            "allowed_domains": [" Docs.Python.org ", "www.github.com", "github.com"],
            "restricted_domains": ["CHATGPT.COM."],
        },
    )
    assert body["policy"]["allowed_domains"] == ["docs.python.org", "github.com"]
    assert body["policy"]["restricted_domains"] == ["chatgpt.com"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": ""},
        {"title": "   "},
        {"title": "x" * 201},
        {"candidate_name": ""},
        {"policy": {"ai_usage": "SOMETIMES"}},
        {"policy": {"ai_usage": "prohibited"}},
        {"policy": {}},
        {"policy": {"ai_usage": "ALLOWED", "restricted_domains": ["https://chatgpt.com/chat"]}},
        {"policy": {"ai_usage": "ALLOWED", "allowed_domains": ["localhost:3000"]}},
        {"policy": {"ai_usage": "ALLOWED", "allowed_domains": ["a.com"], "restricted_domains": ["a.com"]}},
        {"policy": {"ai_usage": "ALLOWED", "allowed_domains": [f"d{i}.com" for i in range(51)]}},
        {"status": "JOINED"},  # server-owned
        {"candidate_join_code": "AAAA-AAAA-AAAA-AAAA"},  # server-owned
    ],
)
def test_invalid_create_payloads_rejected(api, overrides):
    response = api.post("/api/sessions", json=new_session(**overrides), headers=EMPLOYER)
    assert response.status_code == 422, overrides
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_missing_title_or_policy_rejected(api):
    for field in ("title", "policy"):
        body = new_session()
        del body[field]
        response = api.post("/api/sessions", json=body, headers=EMPLOYER)
        assert response.status_code == 422
        assert any(d["location"] == f"body.{field}" for d in response.json()["error"]["details"])


def test_ids_and_codes_are_unique(api):
    created = [create(api) for _ in range(20)]
    assert len({s["session_id"] for s in created}) == 20
    assert len({s["candidate_join_code"] for s in created}) == 20


# --- development employer identity ------------------------------------------


@pytest.mark.parametrize(
    ("headers", "code"),
    [
        ({}, "DEV_EMPLOYER_REQUIRED"),
        ({"X-Vouch-Dev-Employer": "   "}, "DEV_EMPLOYER_REQUIRED"),
        ({"X-Vouch-Dev-Employer": "has space"}, "DEV_EMPLOYER_INVALID"),
        ({"X-Vouch-Dev-Employer": "x" * 65}, "DEV_EMPLOYER_INVALID"),
    ],
)
def test_employer_endpoints_require_dev_identity(api, headers, code):
    for method, path in (("post", "/api/sessions"), ("get", "/api/sessions"), ("get", "/api/sessions/sess_x")):
        kwargs = {"json": new_session()} if method == "post" else {}
        response = getattr(api, method)(path, headers=headers, **kwargs)
        assert response.status_code == 401, (method, path)
        assert response.json()["error"]["code"] == code


# --- secrets never exposed or stored ----------------------------------------


def test_join_code_is_stored_only_as_a_hash(api, db_path):
    body = create(api)
    code = body["candidate_join_code"]
    normalized = code.replace("-", "")
    raw_db = db_path.read_bytes()
    assert code.encode() not in raw_db and normalized.encode() not in raw_db
    with sqlite3.connect(db_path) as conn:
        (stored_hash,) = conn.execute(
            "SELECT join_code_hash FROM sessions WHERE id = ?", (body["session_id"],)
        ).fetchone()
    assert stored_hash == join_codes.hash_join_code(normalized)
    assert re.fullmatch(r"[0-9a-f]{64}", stored_hash)


def test_list_and_detail_never_include_join_code(api):
    body = create(api)
    code = body["candidate_join_code"]
    listed = api.get("/api/sessions", headers=EMPLOYER)
    detail = api.get(f"/api/sessions/{body['session_id']}", headers=EMPLOYER)
    for response in (listed, detail):
        assert response.status_code == 200
        assert code not in response.text and code.replace("-", "") not in response.text
        assert "join_code_hash" not in response.text
        assert "candidate_join_code" not in response.text


def test_join_code_not_logged(api, caplog):
    caplog.set_level("DEBUG")
    code = create(api)["candidate_join_code"]
    api.post("/api/sessions/join", json={"join_code": code})
    assert "Created session" in caplog.text and "joined session" in caplog.text
    assert code not in caplog.text and code.replace("-", "") not in caplog.text


# --- retrieval and persistence ----------------------------------------------


def test_list_returns_only_this_employers_sessions_newest_first(api):
    first = create(api, title="First")
    second = create(api, title="Second")
    create(api, headers=OTHER_EMPLOYER, title="Not mine")

    listed = api.get("/api/sessions", headers=EMPLOYER).json()
    assert listed["total_sessions"] == 2
    assert [s["session_id"] for s in listed["sessions"]] == [second["session_id"], first["session_id"]]
    expected = {k: v for k, v in second.items() if k != "candidate_join_code"}
    assert listed["sessions"][0] == expected


def test_list_empty_for_new_employer(api):
    assert api.get("/api/sessions", headers={"X-Vouch-Dev-Employer": "new-co"}).json() == {
        "total_sessions": 0,
        "sessions": [],
    }


def test_get_session_details(api):
    body = create(api)
    response = api.get(f"/api/sessions/{body['session_id']}", headers=EMPLOYER)
    assert response.status_code == 200
    assert response.json() == {k: v for k, v in body.items() if k != "candidate_join_code"}


def test_get_unknown_or_other_employers_session_is_404(api):
    body = create(api)
    for path, headers in (
        ("/api/sessions/sess_doesnotexist", EMPLOYER),
        (f"/api/sessions/{body['session_id']}", OTHER_EMPLOYER),
    ):
        response = api.get(path, headers=headers)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "SESSION_NOT_FOUND"


def test_sessions_persist_across_restarts(settings):
    with TestClient(create_app(settings), client=LOCAL) as first_run:
        body = create(first_run)
    with TestClient(create_app(settings), client=LOCAL) as second_run:
        detail = second_run.get(f"/api/sessions/{body['session_id']}", headers=EMPLOYER)
        assert detail.status_code == 200
        assert detail.json()["title"] == body["title"]
        joined = second_run.post("/api/sessions/join", json={"join_code": body["candidate_join_code"]})
        assert joined.status_code == 200


# --- joining ----------------------------------------------------------------


def test_valid_join(api):
    body = create(api)
    response = api.post("/api/sessions/join", json={"join_code": body["candidate_join_code"]})
    assert response.status_code == 200
    joined = response.json()
    assert joined["success"] is True
    assert joined["session_id"] == body["session_id"]
    assert joined["title"] == body["title"]
    assert joined["status"] == "JOINED"
    assert joined["policy"] == body["policy"]
    assert joined["candidate_id"].startswith("cand_")
    assert joined["candidate_name"] == "Jordan Lee"
    assert joined["joined_at"].endswith("Z")
    assert body["candidate_join_code"] not in response.text

    detail = api.get(f"/api/sessions/{body['session_id']}", headers=EMPLOYER).json()
    assert detail["status"] == "JOINED"
    assert detail["joined_at"] == joined["joined_at"]
    assert detail["candidate"] == {
        "candidate_id": joined["candidate_id"],
        "name": "Jordan Lee",
        "joined_at": joined["joined_at"],
    }


def test_join_with_candidate_name_override(api):
    body = create(api)
    joined = api.post(
        "/api/sessions/join",
        json={"join_code": body["candidate_join_code"], "candidate_name": "J. Lee"},
    ).json()
    assert joined["candidate_name"] == "J. Lee"


@pytest.mark.parametrize(
    "transform",
    [
        lambda c: c.lower(),
        lambda c: c.replace("-", ""),
        lambda c: c.replace("-", " "),
        lambda c: f"  {c}  ",
    ],
)
def test_join_code_input_is_forgiving(api, transform):
    body = create(api)
    response = api.post("/api/sessions/join", json={"join_code": transform(body["candidate_join_code"])})
    assert response.status_code == 200


def test_join_does_not_need_employer_header(api):
    body = create(api)
    response = api.post("/api/sessions/join", json={"join_code": body["candidate_join_code"]})
    assert response.status_code == 200


@pytest.mark.parametrize(
    "join_code",
    ["AAAA-AAAA-AAAA-AAAA", "ABCD", "not a code at all", "OOOO-IIII-LLLL-UUUU", "A" * 64],
)
def test_invalid_join_code_rejected(api, join_code):
    create(api)
    response = api.post("/api/sessions/join", json={"join_code": join_code})
    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "INVALID_JOIN_CODE"
    assert join_code not in response.text


@pytest.mark.parametrize("payload", [{}, {"join_code": ""}, {"join_code": "x" * 65}, {"join_code": 123}, {"join_code": "A", "session_id": "sess_x"}])
def test_malformed_join_requests_rejected(api, payload):
    response = api.post("/api/sessions/join", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_repeated_join_is_rejected_and_keeps_first_candidate(api):
    body = create(api)
    code = body["candidate_join_code"]
    first = api.post("/api/sessions/join", json={"join_code": code}).json()
    for _ in range(2):
        again = api.post("/api/sessions/join", json={"join_code": code, "candidate_name": "Someone else"})
        assert again.status_code == 409
        assert again.json()["error"]["code"] == "SESSION_ALREADY_JOINED"
    detail = api.get(f"/api/sessions/{body['session_id']}", headers=EMPLOYER).json()
    assert detail["candidate"]["candidate_id"] == first["candidate_id"]
    assert detail["candidate"]["name"] == "Jordan Lee"


def test_simultaneous_joins_only_one_succeeds(settings):
    with TestClient(create_app(settings), client=LOCAL) as api:
        code = create(api)["candidate_join_code"]
        results: list[int] = []
        barrier = threading.Barrier(8)

        def attempt():
            barrier.wait()
            results.append(api.post("/api/sessions/join", json={"join_code": code}).status_code)

        threads = [threading.Thread(target=attempt) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    assert sorted(results) == [200] + [409] * 7


def test_expired_join_code_rejected(api, db_path):
    body = create(api)
    expire(db_path, body["session_id"])
    response = api.post("/api/sessions/join", json={"join_code": body["candidate_join_code"]})
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "JOIN_CODE_EXPIRED"
    detail = api.get(f"/api/sessions/{body['session_id']}", headers=EMPLOYER).json()
    assert detail["status"] == "CREATED" and detail["candidate"] is None


def test_join_code_ttl_is_configurable(db_path):
    settings = Settings(enable_dev_endpoints=True, database_url=f"sqlite:///{db_path}", join_code_ttl_hours=2)
    with TestClient(create_app(settings), client=LOCAL) as api:
        body = create(api)
    created = datetime.fromisoformat(body["created_at"])
    assert datetime.fromisoformat(body["join_code_expires_at"]) - created == timedelta(hours=2)


@pytest.mark.parametrize("hours", [0, -1, 721])
def test_join_code_ttl_bounds(hours):
    with pytest.raises(ValueError, match="VOUCH_JOIN_CODE_TTL_HOURS"):
        Settings(join_code_ttl_hours=hours)


def test_too_many_failed_joins_are_rate_limited(db_path):
    settings = Settings(
        enable_dev_endpoints=True,
        database_url=f"sqlite:///{db_path}",
        join_max_failed_attempts=3,
        join_attempt_window_seconds=600,
    )
    with TestClient(create_app(settings), client=LOCAL) as api:
        code = create(api)["candidate_join_code"]
        for _ in range(3):
            assert api.post("/api/sessions/join", json={"join_code": "AAAA-AAAA-AAAA-AAAA"}).status_code == 401
        blocked = api.post("/api/sessions/join", json={"join_code": code})
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "TOO_MANY_ATTEMPTS"
        assert 1 <= int(blocked.headers["Retry-After"]) <= 601
        # Employer endpoints are unaffected.
        assert api.get("/api/sessions", headers=EMPLOYER).status_code == 200


def test_successful_join_resets_failure_count(db_path):
    settings = Settings(
        enable_dev_endpoints=True,
        database_url=f"sqlite:///{db_path}",
        join_max_failed_attempts=3,
    )
    with TestClient(create_app(settings), client=LOCAL) as api:
        codes = [create(api)["candidate_join_code"] for _ in range(2)]
        for _ in range(2):
            api.post("/api/sessions/join", json={"join_code": "AAAA-AAAA-AAAA-AAAA"})
        assert api.post("/api/sessions/join", json={"join_code": codes[0]}).status_code == 200
        for _ in range(2):
            api.post("/api/sessions/join", json={"join_code": "AAAA-AAAA-AAAA-AAAA"})
        assert api.post("/api/sessions/join", json={"join_code": codes[1]}).status_code == 200


def test_limiter_window_expires():
    limiter = join_codes.JoinAttemptLimiter(max_failures=2, window_seconds=0)
    limiter.record_failure("k")
    limiter.record_failure("k")
    assert limiter.retry_after("k") is None


# --- join code helpers ------------------------------------------------------


def test_generated_codes_use_unambiguous_alphabet():
    for _ in range(200):
        code = join_codes.generate_join_code()
        assert CODE_FORMAT.match(code)
        assert not set(code) & set("01ILOU")


def test_normalize_join_code():
    assert join_codes.normalize_join_code("abcd-efgh-jkmn-pqrs") == "ABCDEFGHJKMNPQRS"
    assert join_codes.normalize_join_code("ABCD EFGH JKMN PQRS") == "ABCDEFGHJKMNPQRS"
    for bad in ["", "ABCD-EFGH-JKMN-PQR", "ABCD-EFGH-JKMN-PQRSX", "ABCD-EFGH-JKMN-PQR0", "ABCD_EFGH_JKMN_PQRS"]:
        assert join_codes.normalize_join_code(bad) is None


# --- gating, access and integration ------------------------------------------


def test_session_routes_absent_when_dev_mode_off(tmp_path):
    with TestClient(create_app(Settings()), client=LOCAL) as api:
        assert api.post("/api/sessions", json=new_session(), headers=EMPLOYER).status_code == 404
        assert api.get("/api/sessions", headers=EMPLOYER).status_code == 404
        assert api.post("/api/sessions/join", json={"join_code": "x"}).status_code == 404
        assert not [p for p in api.app.openapi()["paths"] if p.startswith("/api/sessions")]
    assert not list(tmp_path.glob("*.db"))  # dev mode off creates no database


def test_session_routes_reject_non_local_clients(settings):
    with TestClient(create_app(settings), client=("203.0.113.9", 50000)) as api:
        for response in (
            api.post("/api/sessions", json=new_session(), headers=EMPLOYER),
            api.get("/api/sessions", headers=EMPLOYER),
            api.post("/api/sessions/join", json={"join_code": "AAAA-AAAA-AAAA-AAAA"}),
        ):
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "FORBIDDEN"


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_frontend_cors_allows_dev_employer_header(api, origin):
    preflight = api.options(
        "/api/sessions",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type, x-vouch-dev-employer",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    assert "x-vouch-dev-employer" in preflight.headers["access-control-allow-headers"].lower()

    created = api.post(
        "/api/sessions", json=new_session(), headers={**EMPLOYER, "Origin": origin}
    )
    assert created.status_code == 201
    assert created.headers["access-control-allow-origin"] == origin
    rejected = api.post("/api/sessions/join", json={"join_code": "AAAA-AAAA-AAAA-AAAA"}, headers={"Origin": origin})
    assert rejected.status_code == 401
    assert rejected.headers["access-control-allow-origin"] == origin


def test_health_and_dev_events_still_work(api):
    assert api.get("/health").json() == {"status": "healthy", "service": "vouch-backend"}
    event = {
        "session_id": "dev-session-1",
        "event_type": "EXTENSION_CONNECTED",
        "timestamp": "2026-11-14T10:00:00Z",
        "metadata": {},
    }
    assert api.post("/api/dev/events", json=event).status_code == 201
    assert api.get("/api/dev/events").json()["total_events"] == 1
