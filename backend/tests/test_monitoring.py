"""Milestone 5: candidate credentials, consent, monitoring lifecycle and browser events."""

from __future__ import annotations

import re
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.db import OutdatedDatabaseError
from app.main import create_app
from app.monitoring import tokens

LOCAL = ("127.0.0.1", 50000)
EMPLOYER = {"X-Vouch-Dev-Employer": "acme-hr"}
OTHER_EMPLOYER = {"X-Vouch-Dev-Employer": "globex"}
VERSION = "2026-11-monitoring-v1"


# --- helpers -----------------------------------------------------------------


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "monitoring.db"


def make_settings(db_path, **overrides):
    return Settings(enable_dev_endpoints=True, database_url=f"sqlite:///{db_path}", **overrides)


@pytest.fixture
def settings(db_path):
    return make_settings(db_path)


@pytest.fixture
def api(settings):
    with TestClient(create_app(settings), client=LOCAL) as c:
        yield c


def create_session(api, headers=EMPLOYER, **policy):
    body = {"title": "Backend Interview", "candidate_name": "Jordan Lee", "policy": {"ai_usage": "PROHIBITED", **policy}}
    response = api.post("/api/sessions", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def join(api, headers=EMPLOYER):
    session = create_session(api, headers=headers)
    response = api.post("/api/sessions/join", json={"join_code": session["candidate_join_code"]})
    assert response.status_code == 200, response.text
    return response.json()


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def consent(api, joined, decision="GRANTED", version=VERSION, token=None):
    body = {"decision": decision}
    if version is not None:
        body["consent_version"] = version
    return api.post(f"/api/sessions/{joined['session_id']}/consent", json=body, headers=bearer(token or joined["candidate_token"]))


def start(api, joined, token=None):
    return api.post(f"/api/sessions/{joined['session_id']}/monitoring/start", headers=bearer(token or joined["candidate_token"]))


def stop(api, joined, token=None):
    return api.post(f"/api/sessions/{joined['session_id']}/monitoring/stop", headers=bearer(token or joined["candidate_token"]))


def now_iso(delta_seconds=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_seconds)).isoformat().replace("+00:00", "Z")


def event(seq=0, **overrides):
    e = {
        "client_event_id": str(uuid.uuid4()),
        "event_type": "WEBSITE_NAVIGATION",
        "occurred_at": now_iso(),
        "client_sequence": seq,
        "hostname": "docs.python.org",
        "tab_id": 12,
    }
    e.update(overrides)
    return e


def send(api, joined, events, token=None):
    return api.post(
        f"/api/sessions/{joined['session_id']}/events",
        json={"events": events},
        headers=bearer(token or joined["candidate_token"]),
    )


def active(api):
    joined = join(api)
    assert consent(api, joined).status_code == 200
    assert start(api, joined).status_code == 200
    return joined


def monitoring_view(api, joined, headers=EMPLOYER):
    return api.get(f"/api/sessions/{joined['session_id']}/monitoring", headers=headers)


def events_view(api, joined, headers=EMPLOYER, **params):
    return api.get(f"/api/sessions/{joined['session_id']}/events", headers=headers, params=params)


def error_code(response):
    return response.json()["error"]["code"]


# --- Part 1: candidate credentials ---------------------------------------------


def test_join_issues_candidate_token_once(api, db_path):
    joined = join(api)
    token = joined["candidate_token"]
    assert re.fullmatch(r"vct_[A-Za-z0-9_-]{43}", token)
    assert joined["token_type"] == "Bearer"
    assert joined["required_consent_version"] == VERSION
    expires = datetime.fromisoformat(joined["candidate_token_expires_at"])
    assert expires - datetime.fromisoformat(joined["joined_at"]) == timedelta(hours=24)
    # Milestone 4 fields are unchanged.
    for field in ("success", "session_id", "title", "status", "policy", "candidate_id", "candidate_name", "joined_at"):
        assert field in joined
    assert joined["status"] == "JOINED"

    # Only a hash is stored.
    assert token.encode() not in db_path.read_bytes()
    with sqlite3.connect(db_path) as conn:
        (stored,) = conn.execute("SELECT token_hash FROM session_candidates").fetchone()
    assert stored == tokens.hash_candidate_token(token)

    # Never shown again by employer endpoints.
    for path in (f"/api/sessions/{joined['session_id']}", f"/api/sessions/{joined['session_id']}/monitoring", "/api/sessions"):
        response = api.get(path, headers=EMPLOYER)
        assert response.status_code == 200
        assert token not in response.text and "token_hash" not in response.text


def test_tokens_are_unique(api):
    assert len({join(api)["candidate_token"] for _ in range(10)}) == 10


def test_candidate_state_with_valid_token(api):
    joined = join(api)
    response = api.get(f"/api/sessions/{joined['session_id']}/candidate", headers=bearer(joined["candidate_token"]))
    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == joined["session_id"]
    assert body["candidate_id"] == joined["candidate_id"]
    assert body["title"] == "Backend Interview"
    assert body["policy"] == joined["policy"]
    assert body["consent"] == {"status": "NONE", "consent_version": None, "updated_at": None, "required_version": VERSION}
    assert body["monitoring"] == {"status": "NOT_STARTED", "started_at": None, "stopped_at": None, "stop_reason": None, "events_received": 0}
    assert body["candidate_token_expires_at"] == joined["candidate_token_expires_at"]
    assert joined["candidate_token"] not in response.text


CANDIDATE_CALLS = [
    ("get", "/candidate", None),
    ("post", "/consent", {"decision": "GRANTED", "consent_version": VERSION}),
    ("post", "/monitoring/start", None),
    ("post", "/monitoring/stop", None),
    ("post", "/events", {"events": [event()]}),
]


@pytest.mark.parametrize(("method", "suffix", "body"), CANDIDATE_CALLS)
@pytest.mark.parametrize(
    ("headers", "code"),
    [
        ({}, "CANDIDATE_TOKEN_REQUIRED"),
        ({"Authorization": "Bearer"}, "CANDIDATE_TOKEN_REQUIRED"),
        ({"Authorization": "Basic dXNlcjpwYXNz"}, "CANDIDATE_TOKEN_REQUIRED"),
        ({"Authorization": "Bearer vct_" + "A" * 43}, "INVALID_CANDIDATE_TOKEN"),
        ({"Authorization": "Bearer not-a-token"}, "INVALID_CANDIDATE_TOKEN"),
        (EMPLOYER, "CANDIDATE_TOKEN_REQUIRED"),  # employer header is not a candidate credential
    ],
)
def test_candidate_endpoints_reject_missing_or_invalid_tokens(api, method, suffix, body, headers, code):
    joined = join(api)
    kwargs = {"json": body} if body is not None else {}
    response = getattr(api, method)(f"/api/sessions/{joined['session_id']}{suffix}", headers=headers, **kwargs)
    assert response.status_code == 401, response.text
    assert error_code(response) == code
    assert response.headers.get("www-authenticate") == "Bearer"


def test_candidate_token_is_case_and_space_tolerant_in_scheme_only(api):
    joined = join(api)
    path = f"/api/sessions/{joined['session_id']}/candidate"
    assert api.get(path, headers={"Authorization": f"bearer   {joined['candidate_token']}"}).status_code == 200
    assert api.get(path, headers={"Authorization": f"Bearer {joined['candidate_token'].upper()}"}).status_code == 401


@pytest.mark.parametrize(("method", "suffix", "body"), CANDIDATE_CALLS)
def test_token_for_another_session_is_rejected(api, method, suffix, body):
    mine = join(api)
    other = join(api)
    kwargs = {"json": body} if body is not None else {}
    for session_id in (other["session_id"], "sess_doesnotexist"):
        response = getattr(api, method)(f"/api/sessions/{session_id}{suffix}", headers=bearer(mine["candidate_token"]), **kwargs)
        assert response.status_code == 403
        assert error_code(response) == "SESSION_MISMATCH"
    # The other session is untouched.
    view = monitoring_view(api, other).json()
    assert view["consent"]["status"] == "NONE" and view["monitoring"]["status"] == "NOT_STARTED"


def test_expired_token_rejected(api, db_path):
    joined = join(api)
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).replace(tzinfo=None).isoformat(sep=" ")
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE session_candidates SET token_expires_at = ?", (past,))
    response = api.get(f"/api/sessions/{joined['session_id']}/candidate", headers=bearer(joined["candidate_token"]))
    assert response.status_code == 401
    assert error_code(response) == "CANDIDATE_TOKEN_EXPIRED"


def test_token_ttl_configurable_and_bounded(db_path):
    with TestClient(create_app(make_settings(db_path, candidate_token_ttl_hours=2)), client=LOCAL) as api:
        joined = join(api)
    delta = datetime.fromisoformat(joined["candidate_token_expires_at"]) - datetime.fromisoformat(joined["joined_at"])
    assert delta == timedelta(hours=2)
    for bad in (0, 169):
        with pytest.raises(ValueError, match="VOUCH_CANDIDATE_TOKEN_TTL_HOURS"):
            Settings(candidate_token_ttl_hours=bad)


def test_no_credential_recovery(api):
    """Re-joining never re-issues a token; there is no endpoint that reveals one."""
    session = create_session(api)
    first = api.post("/api/sessions/join", json={"join_code": session["candidate_join_code"]})
    again = api.post("/api/sessions/join", json={"join_code": session["candidate_join_code"]})
    assert first.status_code == 200
    assert again.status_code == 409 and "candidate_token" not in again.text
    paths = api.app.openapi()["paths"]
    assert not [p for p in paths if "token" in p]


def test_token_not_logged(api, caplog):
    caplog.set_level("DEBUG")
    joined = active(api)
    send(api, joined, [event()])
    stop(api, joined)
    assert joined["candidate_token"] not in caplog.text
    assert "joined session" in caplog.text and "monitoring started" in caplog.text


# --- Part 2: consent -----------------------------------------------------------


def test_joining_is_not_consent(api):
    joined = join(api)
    assert monitoring_view(api, joined).json()["consent"]["status"] == "NONE"
    response = start(api, joined)
    assert response.status_code == 409 and error_code(response) == "CONSENT_REQUIRED"


def test_grant_consent(api):
    joined = join(api)
    response = consent(api, joined)
    assert response.status_code == 200
    body = response.json()
    assert body["changed"] is True
    assert body["consent"]["status"] == "GRANTED"
    assert body["consent"]["consent_version"] == VERSION
    assert body["consent"]["updated_at"].endswith("Z")
    assert body["monitoring"]["status"] == "NOT_STARTED"  # consent alone does not start monitoring

    repeat = consent(api, joined).json()
    assert repeat["changed"] is False and repeat["consent"]["updated_at"] == body["consent"]["updated_at"]
    history = monitoring_view(api, joined).json()["consent"]["history"]
    assert [h["decision"] for h in history] == ["GRANTED"]


@pytest.mark.parametrize("version", [None, "", "old-version", "2026-11-monitoring-v0"])
def test_grant_requires_current_consent_version(api, version):
    joined = join(api)
    response = consent(api, joined, version=version)
    assert response.status_code in (409, 422)
    assert error_code(response) in ("CONSENT_VERSION_MISMATCH", "VALIDATION_ERROR")
    assert monitoring_view(api, joined).json()["consent"]["status"] == "NONE"


@pytest.mark.parametrize("body", [{"decision": "MAYBE"}, {"decision": "granted", "consent_version": VERSION}, {}, {"decision": "GRANTED", "consent_version": VERSION, "candidate_id": "cand_x"}, {"decision": "DECLINED", "consent_version": "bad version!"}])
def test_invalid_consent_requests(api, body):
    joined = join(api)
    response = api.post(f"/api/sessions/{joined['session_id']}/consent", json=body, headers=bearer(joined["candidate_token"]))
    assert response.status_code == 422 and error_code(response) == "VALIDATION_ERROR"


def test_decline_consent(api):
    joined = join(api)
    declined = consent(api, joined, "DECLINED", version=None)
    assert declined.status_code == 200
    assert declined.json()["consent"]["status"] == "DECLINED" and declined.json()["changed"] is True
    assert consent(api, joined, "DECLINED", version=None).json()["changed"] is False
    response = start(api, joined)
    assert response.status_code == 409 and error_code(response) == "CONSENT_REQUIRED"
    # Candidate may change their mind before monitoring starts.
    assert consent(api, joined).json()["consent"]["status"] == "GRANTED"
    history = [h["decision"] for h in monitoring_view(api, joined).json()["consent"]["history"]]
    assert history == ["DECLINED", "GRANTED"]


def test_cannot_decline_after_granting(api):
    joined = join(api)
    consent(api, joined)
    response = consent(api, joined, "DECLINED", version=None)
    assert response.status_code == 409 and error_code(response) == "CONSENT_ALREADY_GRANTED"


def test_withdraw_before_start(api):
    joined = join(api)
    consent(api, joined)
    withdrawn = consent(api, joined, "WITHDRAWN", version=None).json()
    assert withdrawn["consent"]["status"] == "WITHDRAWN" and withdrawn["changed"] is True
    assert withdrawn["consent"]["consent_version"] == VERSION
    assert consent(api, joined, "WITHDRAWN", version=None).json()["changed"] is False
    assert error_code(start(api, joined)) == "CONSENT_REQUIRED"
    assert consent(api, joined, "DECLINED", version=None).json()["changed"] is False


@pytest.mark.parametrize("first", [None, "DECLINED"])
def test_cannot_withdraw_without_granting(api, first):
    joined = join(api)
    if first:
        consent(api, joined, first, version=None)
    response = consent(api, joined, "WITHDRAWN", version=None)
    assert response.status_code == 409 and error_code(response) == "CONSENT_NOT_GRANTED"


def test_withdraw_stops_active_monitoring_permanently(api):
    joined = active(api)
    assert send(api, joined, [event()]).status_code == 200
    withdrawn = consent(api, joined, "WITHDRAWN", version=None).json()
    assert withdrawn["monitoring"]["status"] == "STOPPED"
    assert withdrawn["monitoring"]["stop_reason"] == "CONSENT_WITHDRAWN"
    rejected = send(api, joined, [event(1)])
    assert rejected.status_code == 409 and error_code(rejected) == "MONITORING_NOT_ACTIVE"
    # Re-granting cannot silently restart monitoring.
    regrant = consent(api, joined)
    assert regrant.status_code == 409 and error_code(regrant) == "MONITORING_ALREADY_STOPPED"
    assert error_code(start(api, joined)) == "MONITORING_ALREADY_STOPPED"


def test_withdraw_always_works_even_with_old_version(api, db_path, settings):
    joined = active(api)
    # Withdrawal never requires a version, and an unknown one is still recorded.
    response = consent(api, joined, "WITHDRAWN", version="whatever-1")
    assert response.status_code == 200
    history = monitoring_view(api, joined).json()["consent"]["history"]
    assert history[-1] == {**history[-1], "decision": "WITHDRAWN", "consent_version": "whatever-1"}


def test_new_disclosure_version_requires_fresh_consent(db_path):
    with TestClient(create_app(make_settings(db_path)), client=LOCAL) as api:
        joined = join(api)
        consent(api, joined)
    with TestClient(create_app(make_settings(db_path, consent_version="2026-12-v2")), client=LOCAL) as api:
        response = start(api, joined)
        assert response.status_code == 409 and error_code(response) == "CONSENT_VERSION_MISMATCH"
        assert consent(api, joined, version="2026-12-v2").json()["changed"] is True
        assert start(api, joined).json()["monitoring"]["status"] == "ACTIVE"


def test_consent_version_setting_validated():
    with pytest.raises(ValueError, match="VOUCH_CONSENT_VERSION"):
        Settings(consent_version="has spaces")


# --- Part 3: monitoring lifecycle ------------------------------------------------


def test_start_and_stop(api):
    joined = join(api)
    consent(api, joined)
    started = start(api, joined)
    assert started.status_code == 200
    body = started.json()
    assert body["changed"] is True and body["monitoring"]["status"] == "ACTIVE"
    assert body["monitoring"]["started_at"].endswith("Z")

    again = start(api, joined).json()
    assert again["changed"] is False and again["monitoring"]["started_at"] == body["monitoring"]["started_at"]

    stopped = stop(api, joined).json()
    assert stopped["changed"] is True
    assert stopped["monitoring"]["status"] == "STOPPED"
    assert stopped["monitoring"]["stop_reason"] == "CANDIDATE_STOPPED"
    assert stop(api, joined).json()["changed"] is False

    restart = start(api, joined)
    assert restart.status_code == 409 and error_code(restart) == "MONITORING_ALREADY_STOPPED"
    # Consent stays GRANTED; the interview session status is not touched.
    assert stopped["consent"]["status"] == "GRANTED"
    assert api.get(f"/api/sessions/{joined['session_id']}", headers=EMPLOYER).json()["status"] == "JOINED"


def test_stop_before_start_rejected(api):
    joined = join(api)
    response = stop(api, joined)
    assert response.status_code == 409 and error_code(response) == "MONITORING_NOT_STARTED"


def test_state_persists_across_restarts(db_path):
    with TestClient(create_app(make_settings(db_path)), client=LOCAL) as api:
        joined = active(api)
        assert send(api, joined, [event(0)]).json()["stored"] == 1
    with TestClient(create_app(make_settings(db_path)), client=LOCAL) as api:
        state = api.get(f"/api/sessions/{joined['session_id']}/candidate", headers=bearer(joined["candidate_token"])).json()
        assert state["consent"]["status"] == "GRANTED"
        assert state["monitoring"]["status"] == "ACTIVE"
        assert state["monitoring"]["events_received"] == 1
        assert send(api, joined, [event(1)]).json()["stored"] == 1
        stop(api, joined)
    with TestClient(create_app(make_settings(db_path)), client=LOCAL) as api:
        assert error_code(start(api, joined)) == "MONITORING_ALREADY_STOPPED"
        assert events_view(api, joined).json()["total_events"] == 2


# --- Part 4: events ----------------------------------------------------------------


def test_events_rejected_before_consent_and_before_start(api):
    joined = join(api)
    for _ in range(2):
        response = send(api, joined, [event()])
        assert response.status_code == 409 and error_code(response) == "MONITORING_NOT_ACTIVE"
        consent(api, joined)
    assert events_view(api, joined).json()["total_events"] == 0


def test_events_stored_while_active(api, db_path):
    joined = active(api)
    batch = [
        event(0, event_type="TAB_SWITCH", hostname=None, tab_id=3),
        event(1, event_type="TAB_SWITCH", hostname="GitHub.com.", tab_id=4),
        event(2, event_type="WEBSITE_NAVIGATION", hostname="chatgpt.com", tab_id=4),
    ]
    response = send(api, joined, batch)
    assert response.status_code == 200
    body = response.json()
    assert body["stored"] == 3 and body["duplicates"] == 0
    assert [r["client_event_id"] for r in body["results"]] == [e["client_event_id"] for e in batch]
    assert all(r["status"] == "STORED" and r["event_id"].startswith("evt_") for r in body["results"])

    listed = events_view(api, joined).json()
    assert listed["total_events"] == 3 and listed["limit"] == 500 and listed["offset"] == 0
    first, second, third = listed["events"]
    assert set(first) == {"event_id", "event_type", "hostname", "tab_id", "occurred_at", "received_at", "client_sequence", "server_sequence"}
    assert first["hostname"] is None and second["hostname"] == "github.com" and third["hostname"] == "chatgpt.com"
    assert [e["event_type"] for e in listed["events"]] == ["TAB_SWITCH", "TAB_SWITCH", "WEBSITE_NAVIGATION"]
    assert first["occurred_at"] == batch[0]["occurred_at"].replace("Z", "Z")
    assert first["received_at"].endswith("Z")
    assert monitoring_view(api, joined).json()["monitoring"]["events_received"] == 3
    # The client session/candidate IDs are never accepted, and nothing else about the page is stored.
    with sqlite3.connect(db_path) as conn:
        columns = [r[1] for r in conn.execute("PRAGMA table_info(activity_events)")]
    assert not {"url", "path", "query", "title", "page_title", "keystrokes", "screenshot"} & set(columns)


def test_ordering_uses_client_sequence_not_clock(api):
    joined = active(api)
    # Wrong client clock: later sequence numbers have earlier timestamps.
    send(api, joined, [event(2, occurred_at=now_iso(-30)), event(0, occurred_at=now_iso(-10))])
    send(api, joined, [event(1, occurred_at=now_iso(-60))])
    listed = events_view(api, joined).json()["events"]
    assert [e["client_sequence"] for e in listed] == [0, 1, 2]
    by_server = sorted(listed, key=lambda e: e["server_sequence"])
    assert [e["client_sequence"] for e in by_server] == [2, 0, 1]


def test_duplicate_submission_is_not_stored_twice(api):
    joined = active(api)
    e = event(0)
    first = send(api, joined, [e]).json()
    retry = send(api, joined, [e, event(1)]).json()
    assert retry["stored"] == 1 and retry["duplicates"] == 1
    assert retry["results"][0] == {**first["results"][0], "status": "DUPLICATE"}
    assert events_view(api, joined).json()["total_events"] == 2
    assert monitoring_view(api, joined).json()["monitoring"]["events_received"] == 2


def test_reused_event_id_with_different_content_rejects_whole_batch(api):
    joined = active(api)
    e = event(0)
    send(api, joined, [e])
    response = send(api, joined, [event(5), {**e, "hostname": "chatgpt.com"}])
    assert response.status_code == 409 and error_code(response) == "EVENT_ID_CONFLICT"
    assert events_view(api, joined).json()["total_events"] == 1


def test_same_client_event_id_allowed_for_different_candidates(api):
    a, b = active(api), active(api)
    e = event(0)
    assert send(api, a, [e]).json()["stored"] == 1
    assert send(api, b, [e]).json()["stored"] == 1


@pytest.mark.parametrize(
    "overrides",
    [
        {"event_type": "TAB_CREATED"},
        {"event_type": "website_navigation"},
        {"event_type": "WEBSITE_NAVIGATION", "hostname": None},
        {"hostname": "https://chatgpt.com"},
        {"hostname": "chatgpt.com/c/123"},
        {"hostname": "chatgpt.com:443"},
        {"hostname": "chatgpt.com?q=1"},
        {"hostname": "user@chatgpt.com"},
        {"hostname": "chat gpt.com"},
        {"hostname": "-bad.com"},
        {"hostname": "a" * 64 + ".com"},
        {"hostname": ""},
        {"occurred_at": "2026-11-18T10:00:00"},
        {"occurred_at": "2026-11-18T10:00:00-05:00"},
        {"occurred_at": 1795000000},
        {"occurred_at": "yesterday"},
        {"client_sequence": -1},
        {"client_sequence": "1"},
        {"tab_id": -1},
        {"client_event_id": "short"},
        {"client_event_id": "has spaces in it"},
        {"url": "https://chatgpt.com/c/secret"},
        {"title": "My private chat"},
        {"session_id": "sess_other"},
        {"candidate_id": "cand_other"},
        {"keystrokes": "abc"},
    ],
)
def test_invalid_events_rejected_and_not_stored(api, overrides):
    joined = active(api)
    response = send(api, joined, [event(0, **overrides)])
    assert response.status_code == 422, (overrides, response.text)
    assert error_code(response) == "VALIDATION_ERROR"
    assert response.json()["error"]["details"][0]["location"].startswith("body.events.0")
    assert events_view(api, joined).json()["total_events"] == 0


@pytest.mark.parametrize("hostname", ["localhost", "127.0.0.1", "xn--bcher-kva.de", "a.b.c.example.co.uk"])
def test_valid_hostname_forms(api, hostname):
    joined = active(api)
    assert send(api, joined, [event(0, hostname=hostname)]).status_code == 200


@pytest.mark.parametrize(
    "body",
    [{}, {"events": []}, {"events": "x"}, {"events": [event(), event()], "session_id": "x"}, [event()]],
)
def test_invalid_batches_rejected(api, body):
    joined = active(api)
    response = api.post(f"/api/sessions/{joined['session_id']}/events", json=body, headers=bearer(joined["candidate_token"]))
    assert response.status_code == 422 and error_code(response) == "VALIDATION_ERROR"


def test_duplicate_ids_within_one_batch_rejected(api):
    joined = active(api)
    e = event(0)
    response = send(api, joined, [e, {**e, "client_sequence": 1}])
    assert response.status_code == 422


def test_non_json_body_rejected(api):
    joined = active(api)
    response = api.post(
        f"/api/sessions/{joined['session_id']}/events",
        content=b"not json",
        headers={**bearer(joined["candidate_token"]), "Content-Type": "application/json"},
    )
    assert response.status_code == 422 and error_code(response) == "VALIDATION_ERROR"


def test_timestamps_before_start_or_in_future_rejected(api):
    joined = active(api)
    for occurred_at in (now_iso(-3600), now_iso(3600)):
        response = send(api, joined, [event(0), event(1, occurred_at=occurred_at)])
        assert response.status_code == 422
        body = response.json()["error"]
        assert body["code"] == "EVENT_TIMESTAMP_OUT_OF_RANGE"
        assert body["details"][0]["location"] == "body.events.1.occurred_at"
    # Small clock differences are tolerated.
    assert send(api, joined, [event(0, occurred_at=now_iso(120))]).status_code == 200
    assert events_view(api, joined).json()["total_events"] == 1


def test_events_rejected_after_stop(api):
    joined = active(api)
    send(api, joined, [event(0)])
    stop(api, joined)
    response = send(api, joined, [event(1)])
    assert response.status_code == 409 and error_code(response) == "MONITORING_NOT_ACTIVE"
    assert events_view(api, joined).json()["total_events"] == 1


def test_too_many_events_per_request(db_path):
    with TestClient(create_app(make_settings(db_path, max_events_per_request=3)), client=LOCAL) as api:
        joined = active(api)
        response = send(api, joined, [event(i) for i in range(4)])
        assert response.status_code == 422 and "at most 3 events" in response.json()["error"]["message"]
        assert send(api, joined, [event(i) for i in range(3)]).json()["stored"] == 3


def test_request_size_limit(db_path):
    with TestClient(create_app(make_settings(db_path, max_event_request_bytes=1024)), client=LOCAL) as api:
        joined = active(api)
        response = send(api, joined, [event(i) for i in range(10)])
        assert response.status_code == 413 and error_code(response) == "PAYLOAD_TOO_LARGE"
        assert events_view(api, joined).json()["total_events"] == 0


def test_event_rate_limit(db_path):
    with TestClient(create_app(make_settings(db_path, max_events_per_minute=5)), client=LOCAL) as api:
        joined = active(api)
        assert send(api, joined, [event(i) for i in range(5)]).status_code == 200
        limited = send(api, joined, [event(5)])
        assert limited.status_code == 429 and error_code(limited) == "RATE_LIMITED"
        assert 1 <= int(limited.headers["Retry-After"]) <= 61
        # Rate limits are per candidate.
        other = active(api)
        assert send(api, other, [event(0)]).status_code == 200


def test_session_event_cap(db_path):
    with TestClient(create_app(make_settings(db_path, max_events_per_session=3)), client=LOCAL) as api:
        joined = active(api)
        assert send(api, joined, [event(i) for i in range(3)]).json()["stored"] == 3
        full = send(api, joined, [event(3)])
        assert full.status_code == 409 and error_code(full) == "EVENT_LIMIT_REACHED"


def test_stop_racing_with_event_submission(db_path):
    """However submissions and a stop interleave, nothing is stored after STOPPED."""
    with TestClient(create_app(make_settings(db_path)), client=LOCAL) as api:
        joined = active(api)
        barrier = threading.Barrier(9)
        statuses = []

        def submit(i):
            barrier.wait()
            statuses.append(send(api, joined, [event(i)]).status_code)

        def do_stop():
            barrier.wait()
            stop(api, joined)

        threads = [threading.Thread(target=submit, args=(i,)) for i in range(8)] + [threading.Thread(target=do_stop)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        stopped_at = monitoring_view(api, joined).json()["monitoring"]["stopped_at"]
        listed = events_view(api, joined).json()
    assert set(statuses) <= {200, 409}
    assert listed["total_events"] == statuses.count(200)
    assert all(e["received_at"] <= stopped_at for e in listed["events"])


# --- Part 5: employer visibility ------------------------------------------------


def test_employer_monitoring_view(api):
    joined = active(api)
    send(api, joined, [event(0)])
    view = monitoring_view(api, joined)
    assert view.status_code == 200
    body = view.json()
    assert body["session_id"] == joined["session_id"]
    assert body["session_status"] == "JOINED"
    assert body["candidate"]["candidate_id"] == joined["candidate_id"]
    assert body["consent"]["status"] == "GRANTED"
    assert [h["decision"] for h in body["consent"]["history"]] == ["GRANTED"]
    assert body["monitoring"]["status"] == "ACTIVE"
    assert body["monitoring"]["events_received"] == 1
    assert body["monitoring"]["last_event_received_at"].endswith("Z")


def test_employer_view_before_join(api):
    session = create_session(api)
    body = api.get(f"/api/sessions/{session['session_id']}/monitoring", headers=EMPLOYER).json()
    assert body["session_status"] == "CREATED" and body["candidate"] is None
    assert body["consent"] == {"status": "NONE", "consent_version": None, "updated_at": None, "history": []}
    assert body["monitoring"]["status"] == "NOT_STARTED"
    assert api.get(f"/api/sessions/{session['session_id']}/events", headers=EMPLOYER).json()["total_events"] == 0


def test_employer_isolation(api):
    joined = active(api)
    send(api, joined, [event(0)])
    for path in ("monitoring", "events"):
        other = api.get(f"/api/sessions/{joined['session_id']}/{path}", headers=OTHER_EMPLOYER)
        assert other.status_code == 404 and error_code(other) == "SESSION_NOT_FOUND"
        missing = api.get(f"/api/sessions/{joined['session_id']}/{path}")
        assert missing.status_code == 401 and error_code(missing) == "DEV_EMPLOYER_REQUIRED"
        # A candidate token is not an employer credential.
        as_candidate = api.get(f"/api/sessions/{joined['session_id']}/{path}", headers=bearer(joined["candidate_token"]))
        assert as_candidate.status_code == 401


def test_employer_events_pagination(api):
    joined = active(api)
    send(api, joined, [event(i) for i in range(7)])
    page = events_view(api, joined, limit=3, offset=3).json()
    assert page["total_events"] == 7 and page["limit"] == 3 and page["offset"] == 3
    assert [e["client_sequence"] for e in page["events"]] == [3, 4, 5]
    for bad in ({"limit": 0}, {"limit": 1001}, {"offset": -1}):
        assert events_view(api, joined, **bad).status_code == 422


def test_employer_cannot_change_monitoring(api):
    joined = join(api)
    for suffix in ("/consent", "/monitoring/start", "/monitoring/stop"):
        response = api.post(f"/api/sessions/{joined['session_id']}{suffix}", json={"decision": "GRANTED", "consent_version": VERSION}, headers=EMPLOYER)
        assert response.status_code == 401
    assert monitoring_view(api, joined).json()["consent"]["status"] == "NONE"


# --- gating, compatibility, regressions -----------------------------------------


def test_monitoring_routes_absent_when_dev_mode_off():
    with TestClient(create_app(Settings()), client=LOCAL) as api:
        for path in ("/api/sessions/s/candidate", "/api/sessions/s/monitoring", "/api/sessions/s/events"):
            assert api.get(path).status_code == 404


def test_monitoring_routes_are_local_only(settings, db_path):
    with TestClient(create_app(settings), client=LOCAL) as api:
        joined = join(api)
    with TestClient(create_app(settings), client=("203.0.113.9", 50000)) as remote:
        for response in (
            remote.get(f"/api/sessions/{joined['session_id']}/candidate", headers=bearer(joined["candidate_token"])),
            remote.post(f"/api/sessions/{joined['session_id']}/consent", json={"decision": "GRANTED", "consent_version": VERSION}, headers=bearer(joined["candidate_token"])),
            remote.get(f"/api/sessions/{joined['session_id']}/events", headers=EMPLOYER),
        ):
            assert response.status_code == 403 and error_code(response) == "FORBIDDEN"


def test_extension_origin_cors_with_authorization_header(db_path):
    ext = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    with TestClient(create_app(make_settings(db_path, extension_origins=(ext,))), client=LOCAL) as api:
        preflight = api.options(
            "/api/sessions/sess_x/events",
            headers={"Origin": ext, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type"},
        )
        assert preflight.status_code == 200
        assert "authorization" in preflight.headers["access-control-allow-headers"].lower()


def test_outdated_milestone4_database_fails_clearly(db_path):
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE employers (id INTEGER PRIMARY KEY, dev_key VARCHAR(64), created_at DATETIME);
            CREATE TABLE sessions (id VARCHAR(40) PRIMARY KEY);
            CREATE TABLE session_candidates (id VARCHAR(40) PRIMARY KEY, session_id VARCHAR(40), display_name VARCHAR(120), joined_at DATETIME);
            """
        )
    with pytest.raises(OutdatedDatabaseError, match="delete backend/data/vouch.db"):
        create_app(make_settings(db_path))


def test_milestone4_join_contract_still_satisfied(api):
    """The extension's Milestone 4 validator only needs these fields; new ones are additive."""
    joined = join(api)
    assert joined["success"] is True and joined["status"] == "JOINED"
    for key in ("session_id", "candidate_id", "title", "joined_at"):
        assert isinstance(joined[key], str) and joined[key]
    assert joined["policy"]["ai_usage"] in ("PROHIBITED", "PARTIALLY_ALLOWED", "ALLOWED")
    detail = api.get(f"/api/sessions/{joined['session_id']}", headers=EMPLOYER).json()
    assert set(detail) == {"session_id", "title", "candidate_name", "status", "policy", "created_at", "join_code_expires_at", "joined_at", "candidate"}
    assert set(detail["candidate"]) == {"candidate_id", "name", "joined_at"}
