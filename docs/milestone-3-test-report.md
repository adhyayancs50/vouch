# Milestone 3 QA test report

Branch: `testing/milestone-3` (same commit as `main` at the time of this report: `37378de`).

This report covers QA inspection, the backend pytest run, and the manual checks Javier performed on November 13, 2026. It does not mean the Milestone 3 product workflow is complete. Automated results and manual results are recorded separately.

## 1. Testing scope and current project status

Milestone 3 in `docs/04-feature-specifications.md` is backend integration:

- Create an interview session.
- Let a candidate join that session.
- Submit activity events.
- Store events in SQLite.
- Retrieve the stored events.

Those product behaviors are not in the repository. There is no session API, no candidate join or token, no SQLite layer, and no `POST` or `GET /api/sessions/{session_id}/events`.

What exists today is a separate, temporary development contract:

| Route | Role |
| --- | --- |
| `GET /health` | Liveness check. Returns `{"status": "healthy", "service": "vouch-backend"}`. It does not check a database. |
| `POST /api/dev/events` | Accepts one test event and keeps it in memory. |
| `GET /api/dev/events` | Lists those in-memory events. |

`/api/dev/events` is registered only when `VOUCH_ENABLE_DEV_ENDPOINTS=true` and `VOUCH_ENV=development`. The default is off, in which case the routes are absent (HTTP 404) and are not listed in OpenAPI. Requests must come from the local machine. Stored events are dropped when the process stops. The only accepted `event_type` is `EXTENSION_CONNECTED`.

`docs/05-api-and-database-documentation.md` still defines the real product API, including `POST /api/sessions` and `POST`/`GET /api/sessions/{session_id}/events`. The dev routes are not a substitute for that API. `backend/app/dev/events.py` states this directly.

QA in this pass read the backend, extension, frontend health client, and docs, ran the backend pytest suite after adding three edge-case tests, and recorded Javier's manual checks from November 13, 2026. No application source file was changed. Those manual checks exercised the temporary dev routes and the local tab-switch controls. They did not exercise the product session API.

## 2. Automated backend tests completed

Automated tests live in `backend/tests/` and use pytest with FastAPI's `TestClient`. They do not start a separate uvicorn process.

| File | What the existing suite already covered |
| --- | --- |
| `test_health.py` | `GET /health` JSON, `/docs`, and OpenAPI listing only `/health` when dev endpoints are off |
| `test_errors.py` | 404, 405 on `POST /health`, 422 shape, generic 500 |
| `test_cors.py` | Local frontend origins, rejected unknown origins, CORS headers on error responses |
| `test_dev_events.py` | Valid dev-event create and list, validation failures, disabled-by-default 404, loopback-only access, env parsing, extension CORS |
| `conftest.py` | Default app fixture with dev endpoints off |

This pass added three tests to `backend/tests/test_dev_events.py`. No other test file was changed. There is no frontend test runner, no automated Chrome extension suite, and no GitHub Actions workflow in the repository.

The suite was run from `backend/` after creating a local virtualenv (gitignored) and installing `requirements-dev.txt`. The interpreter was Python 3.14.7. The project documents Python 3.11+.

## 3. Details of the three new edge-case tests

These tests use the existing `dev_client` fixture. They do not change the API.

**`test_identical_timestamps_keep_receive_order`**

Posts three valid events that share the timestamp `2026-11-12T20:30:00Z`, in session-id order `z-session`, `a-session`, `m-session`. That order is the opposite of alphabetical order. `GET /api/dev/events` must return those three ids in submission order, with `received_at` values that do not go backwards. A second GET must return the same id order. This matches the current store, which sorts by client `timestamp` and then server `received_at`.

**`test_client_supplied_event_id_rejected`**

Stores one valid event, then posts another body that also includes `event_id`. The response must be HTTP 422 with `error.code` `VALIDATION_ERROR` and a detail location of `body.event_id`. `GET /api/dev/events` must still report `total_events` 1 and the original id. The server assigns `event_id`; the client must not.

**`test_client_supplied_received_at_rejected`**

Same sequence for a client-supplied `received_at` of `2020-01-01T00:00:00Z`. The response must be HTTP 422 with location `body.received_at`, and the stored count must stay 1. `received_at` is set by the server when an event is accepted.

No application bug was found while adding these tests. `DevEventIn` already rejects extra fields, and `DevEventStore.list` already sorts by `(timestamp, received_at)`.

## 4. Actual pytest results

Command: `pytest -q` from `backend/`.

| Result | Count |
| --- | --- |
| Passed | 64 |
| Failed | 0 |

Runtime was about 0.20 seconds. This count includes the three new tests and the tests that were already in the suite. It is an automated result only. The Chrome checks in section 7 are manual and are not part of this count. Pytest did not cover the employer dashboard, session creation, SQLite, or the product event API.

## 5. Existing warning and its implications

Pytest printed one warning:

`StarletteDeprecationWarning: Using httpx with starlette.testclient is deprecated; install httpx2 instead.`

It is raised from `fastapi/testclient.py` inside the installed FastAPI package, when that package imports Starlette's `TestClient`. It is not a failure of `GET /health` or `/api/dev/events`, and it did not fail any test.

The warning means the current test stack (FastAPI 0.162.0 with httpx 0.28.1, as pinned in `requirements.txt` and `requirements-dev.txt`) is on a path Starlette has marked as deprecated. This report does not change those pins. A later dependency update should be a separate, reviewed change so the suite can keep running after Starlette drops the httpx-based test client.

## 6. Security and privacy observations

These are observations from the current code and docs, not the results of a penetration test.

- The dev routes are off unless `VOUCH_ENABLE_DEV_ENDPOINTS=true`, and that flag is refused unless `VOUCH_ENV=development`.
- Each dev request must come from a loopback address. Other clients receive HTTP 403.
- The dev route does not check a candidate token, a session row, or an employer. A local caller can store any `session_id` string that passes length checks. That is acceptable only as a local test hook, not as the product event API.
- Events stay in process memory (at most 1,000). They are not written to SQLite.
- The server generates `event_id` and `received_at`. The new tests check that the client cannot set either field.
- The dev contract accepts only `EXTENSION_CONNECTED` and a metadata object of at most 4 KB. Unknown top-level fields are rejected. This is narrower than the five product event types in `docs/05`.
- `GET /health` does not reveal stored events.
- `backend/SECURITY_NOTES_DRAFT.md` is explicitly a draft. It says the product validation rules (candidate token, active session, duplicate `event_id`, five event types) are not implemented. Those rules apply to `/api/sessions/{session_id}/events`, which does not exist yet. The open questions in that draft (token format, domain versus URL, employer auth) are still unanswered in code.
- The extension's manual test button, as written in `extension/test-event.js`, sends one synthetic event: `session_id` `test-session-001`, `event_type` `EXTENSION_CONNECTED`, a UTC timestamp, and empty `metadata`. The source does not attach the locally stored tab records to that request. Whether a recording session stays off the backend was not checked in the November 13 manual run. That run did confirm the button's success path, recorded in section 7.

## 7. Manual Chrome extension testing

Javier performed the checks below on November 13, 2026. The success and local-recording checks used a local FastAPI backend with development endpoints enabled. The disconnection check was done after that server was stopped. These are manual results. They are not part of the pytest count in section 4. No event-id strings, HTTP status codes, or response bodies were copied into this report beyond what he reported.

### Passed on November 13, 2026

| Check | Result |
| --- | --- |
| Started the FastAPI backend locally with development endpoints enabled | Passed |
| Opened `GET /health` in Chrome and confirmed the expected healthy JSON response | Passed |
| Loaded the VOUCH Chrome extension from `chrome://extensions` | Passed |
| Clicked **Send Test Event** and received a success message | Passed |
| Sent four test events in total | Passed |
| Opened `GET /api/dev/events` and confirmed all four events appeared | Passed |
| Confirmed the event IDs shown by the extension matched the IDs returned by the backend | Passed |
| Gave consent and started a local recording session | Passed |
| Switched Chrome tabs and confirmed **Recorded switches** increased to 6 | Passed |
| Stopped the session and confirmed recording stopped | Passed |
| Stopped the FastAPI server, clicked **Send Test Event**, and confirmed a clear connection-error message instead of a false success. The extension interface stayed visible and usable | Passed |
| Verified recording cannot start without consent: the Start button was disabled, the status remained "Not recording", and switching tabs did not increase the recorded-switch count or create new events | Passed |
| Verified that five Chrome tab switches during an active local recording session did not upload events to the backend: `total_events` remained at 0 before and after | Passed |
| Restarted the backend with `VOUCH_ENABLE_DEV_ENDPOINTS=false`; `GET /health` returned healthy and `GET /api/dev/events` returned `NOT_FOUND` | Passed |
| Submitted one test event and confirmed `total_events` was 1; restarted the FastAPI backend and confirmed `total_events` dropped to 0 | Passed |
| With `VOUCH_ENABLE_DEV_ENDPOINTS=false`, clicked **Send Test Event** and confirmed HTTP 404. The extension displayed a clear error message instead of reporting success | Passed |
| Started the backend with `VOUCH_ENABLE_DEV_ENDPOINTS` omitted entirely; `GET /health` returned healthy and `GET /api/dev/events` returned `NOT_FOUND` | Passed |
The success and recording checks use the temporary dev endpoints and the extension's local recording controls. They are not a product interview session, and they do not show that events are stored in SQLite. The disconnection check covers only the stopped-server case. Timeout, 403, 404, and 422 were not part of it.

### Not tested

The following were not run. They are not passed.

| Scenario | Status |
| --- | --- |
| Verify through Chrome DevTools Network inspection that no tab-switch data is transmitted to any other endpoints | Not tested |
| Timeout, 403, 404, and 422 error handling | Not tested |
| Any real product session API (`/api/sessions`, join, and `/api/sessions/{session_id}/events`) | Not tested. These routes are not implemented. |

## 8. Known limitations and dependencies

Full Milestone 3 is blocked on other components. This QA pass cannot test them because they are not implemented.

| Teammate | Dependency |
| --- | --- |
| Srihith (backend) | Product session creation, candidate join, activity submission, SQLite storage, and retrieval. Until `POST /api/sessions`, join/start, and `POST`/`GET /api/sessions/{session_id}/events` exist, QA cannot test persistence across restart, duplicate product event ids, or employer retrieval. |
| Justin (extension) | **Send Test Event** is the only extension call to the backend that this report exercised. The November 13 run did not check whether local tab-switch records stay off that request. Sending those records to a real session still waits on his extension and on Srihith's product route. Automated Chrome tests were not added. |
| Ada (frontend) | The dashboard calls `GET /health` only (`frontend/src/api.ts`). It does not create a session or show stored events. Session UI is Milestone 4 in the feature spec. |

Other limits of this report:

- `backend/README.md` still describes a foundation-only API and does not document `VOUCH_ENABLE_DEV_ENDPOINTS`. `extension/README.md` and `backend/.env.example` do. This report does not edit that README.
- Pytest uses `TestClient`. A live uvicorn process was not part of that automated run. Javier did start a live local backend for the manual checks in section 7.
- No CI configuration is present, so these pytest results are local only.

## 9. Recommended next QA activities

1. Finish the untested rows in section 7. The November 13 happy path is already passed, including the stopped-server connection error. Still open: recording before consent, whether tab-switch records stay local, timeout, 403, 404, and 422 handling, session persistence after a Chrome restart, backend restart clearing the dev-event list, and the disabled-endpoint 404. Do not mark those passed until they are run.
2. Keep product-session tests out of the suite until Srihith's routes and SQLite storage exist. When they do, add them against `docs/05` (`/api/sessions/...`), not against `/api/dev/events`.
3. After that API exists, test the draft rules that are still unimplemented: missing or wrong candidate token, inactive session, duplicate `event_id`, and the five product event types. Resolve the open questions in `backend/SECURITY_NOTES_DRAFT.md` with Srihith before writing those assertions.
4. Ask Justin before adding any Chrome automation. The current extension test is a manual popup flow.
5. Ask Ada before expecting the dashboard to create sessions or list events. A health-button check is the only frontend backend call today.
6. Update `backend/README.md` in a separate change so testers are not sent to a 404 by missing the dev-endpoint flag.
7. Treat the `httpx2` warning as a dependency follow-up, not as a failed test.
