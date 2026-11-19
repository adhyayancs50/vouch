# Monitoring API contract (Milestone 5)

For **Justin** (Chrome extension) and **Ada** (employer dashboard). Owner: Srihith (backend).
Builds on [`API_SESSIONS.md`](API_SESSIONS.md) (create, list, join).

> **Development only.** Every route here exists only when the backend runs with
> `VOUCH_ENABLE_DEV_ENDPOINTS=true`, and only answers requests from the same machine. Employer
> identity is still a header anyone can set. The candidate token is a real random credential, but
> there is no production login, HTTPS or deployment yet. Vouch records observable browser
> activity; it does not and cannot detect AI use, and these endpoints make no judgments.

## Overview

```
Candidate (extension)                                   Employer (dashboard)
POST /api/sessions/join            -> candidate_token   GET /api/sessions/{id}/monitoring
GET  /api/sessions/{id}/candidate                       GET /api/sessions/{id}/events
POST /api/sessions/{id}/consent
POST /api/sessions/{id}/monitoring/start
POST /api/sessions/{id}/events
POST /api/sessions/{id}/monitoring/stop
```

Base URL `http://127.0.0.1:8000`. JSON in and out. Timestamps are UTC ISO 8601 ending in `Z`.
Errors use the standard shape (see [Errors](#errors)).

## Authentication

### Candidate token (Justin)

`POST /api/sessions/join` now also returns a candidate credential:

```json
{
  "success": true,
  "session_id": "sess_7255a0ce3b844db1b154d2e26429ea73",
  "title": "Backend Engineer Interview",
  "status": "JOINED",
  "policy": { "ai_usage": "PROHIBITED", "allowed_domains": [], "restricted_domains": ["chatgpt.com"] },
  "candidate_id": "cand_e3668da15ce7439bb5bc1b790ec81db7",
  "candidate_name": "Jordan Lee",
  "joined_at": "2026-11-18T10:00:00.000000Z",
  "candidate_token": "vct_3q2-7oV1v8kQ9yZbW5mN0aT4cR6dE8fG1hJ2kL3mN4o",
  "token_type": "Bearer",
  "candidate_token_expires_at": "2026-11-19T10:00:00.000000Z",
  "required_consent_version": "2026-11-monitoring-v1"
}
```

The last four fields are new; everything else is unchanged from Milestone 4.

- Send it on every candidate request: `Authorization: Bearer <candidate_token>`.
- It is shown **once**. The server keeps only a SHA-256 hash and has no way to show it again or
  issue a new one. Store it in `chrome.storage.local` (not `sync`), never in a URL, and never log it.
- It identifies exactly one candidate in one session. The `{session_id}` in the URL must be that
  session, or the request gets `403 SESSION_MISMATCH`. Identity always comes from the token:
  request bodies that include `session_id` or `candidate_id` are rejected with `422`.
- Valid for 24 hours (`VOUCH_CANDIDATE_TOKEN_TTL_HOURS`). If it is lost or expires, the candidate
  needs a new session from the employer.

### Employer header (Ada)

Unchanged: `X-Vouch-Dev-Employer: <key>`. An employer only sees its own sessions; another
employer's session returns `404 SESSION_NOT_FOUND`.

## States

The interview session `status` (`CREATED` → `JOINED`) is unchanged. Consent and monitoring are
separate, per candidate, and persist across backend restarts.

### Consent

| Current | `GRANTED` | `DECLINED` | `WITHDRAWN` |
| --- | --- | --- | --- |
| `NONE` | → `GRANTED` | → `DECLINED` | `409 CONSENT_NOT_GRANTED` |
| `DECLINED` | → `GRANTED` | no change | `409 CONSENT_NOT_GRANTED` |
| `GRANTED` | no change (same version) | `409 CONSENT_ALREADY_GRANTED` | → `WITHDRAWN`, and ACTIVE monitoring → `STOPPED` |
| `WITHDRAWN` | → `GRANTED` (only if monitoring never started) | no change | no change |

- Joining is **not** consent. Consent starts as `NONE`.
- `GRANTED` needs `consent_version` equal to `required_consent_version` (from the join response or
  `GET .../candidate`). It is the version of the disclosure text the extension showed. Otherwise
  `409 CONSENT_VERSION_MISMATCH`.
- `GRANTED` is refused with `409 MONITORING_ALREADY_STOPPED` once monitoring has stopped.
- `WITHDRAWN` never needs a version and always works while consent is granted.
- Every change is appended to a consent history the employer can see. Repeats return
  `"changed": false` and add nothing.

### Monitoring

```
NOT_STARTED --start (needs GRANTED consent)--> ACTIVE --stop / withdraw--> STOPPED (final)
```

| Current | `start` | `stop` |
| --- | --- | --- |
| `NOT_STARTED` | → `ACTIVE` if consent is `GRANTED` at the current version; else `409 CONSENT_REQUIRED` / `CONSENT_VERSION_MISMATCH` | `409 MONITORING_NOT_STARTED` |
| `ACTIVE` | no change (`changed: false`) | → `STOPPED` (`stop_reason: CANDIDATE_STOPPED`) |
| `STOPPED` | `409 MONITORING_ALREADY_STOPPED` (never restarts) | no change (`changed: false`) |

Withdrawing consent while `ACTIVE` sets `STOPPED` with `stop_reason: CONSENT_WITHDRAWN`.
Events are accepted **only** while `ACTIVE`.

Event submission, stop, and consent withdrawal each run in a SQLite write transaction that takes its reserved lock at `BEGIN` (`BEGIN IMMEDIATE`). Those three cannot be inside a write transaction at the same time. `received_at` and `monitoring_stopped_at` are read only after the statement that claims the row has returned, still before commit.

The cutoff is that commit order, not which HTTP request started first:

- An event transaction that commits while monitoring is still `ACTIVE` is kept. Its `received_at` is earlier than the `stopped_at` of a stop or withdrawal that commits afterward.
- Once the stop or withdrawal transaction has committed, a later event transaction does not store those events. It returns `409 MONITORING_NOT_ACTIVE`.
- An overlapping request does not change timestamps of a transaction that already committed.

## Candidate endpoints (Justin)

All need `Authorization: Bearer <candidate_token>`.

### Candidate state object

Returned by `GET .../candidate`, and (plus `changed`) by consent, start and stop:

```json
{
  "session_id": "sess_7255a0ce3b844db1b154d2e26429ea73",
  "candidate_id": "cand_e3668da15ce7439bb5bc1b790ec81db7",
  "title": "Backend Engineer Interview",
  "policy": { "ai_usage": "PROHIBITED", "allowed_domains": [], "restricted_domains": ["chatgpt.com"] },
  "consent": {
    "status": "GRANTED",
    "consent_version": "2026-11-monitoring-v1",
    "updated_at": "2026-11-18T10:01:00.000000Z",
    "required_version": "2026-11-monitoring-v1"
  },
  "monitoring": {
    "status": "ACTIVE",
    "started_at": "2026-11-18T10:01:05.000000Z",
    "stopped_at": null,
    "stop_reason": null,
    "events_received": 42
  },
  "candidate_token_expires_at": "2026-11-19T10:00:00.000000Z",
  "changed": true
}
```

`consent.status`: `NONE`, `GRANTED`, `DECLINED`, `WITHDRAWN`.
`monitoring.status`: `NOT_STARTED`, `ACTIVE`, `STOPPED`.
`monitoring.stop_reason`: `null`, `CANDIDATE_STOPPED`, `CONSENT_WITHDRAWN`.
`changed` is only on consent/start/stop responses: `false` means the call was a repeat.

### `GET /api/sessions/{session_id}/candidate`

Current state, e.g. when the popup or service worker restarts. `200` with the state object.

### `POST /api/sessions/{session_id}/consent`

```json
{ "decision": "GRANTED", "consent_version": "2026-11-monitoring-v1" }
```

| Field | Required | Rules |
| --- | --- | --- |
| `decision` | yes | `GRANTED`, `DECLINED` or `WITHDRAWN` (uppercase) |
| `consent_version` | for `GRANTED` | Must equal `required_consent_version`. Optional (recorded if sent) for the others. 1–64 chars: letters, digits, `.` `_` `-`. |

`200` with the state object. Errors: `409 CONSENT_VERSION_MISMATCH`, `CONSENT_ALREADY_GRANTED`,
`CONSENT_NOT_GRANTED`, `MONITORING_ALREADY_STOPPED`; `422 VALIDATION_ERROR`.

### `POST /api/sessions/{session_id}/monitoring/start`

No body. `200` with the state object. Errors: `409 CONSENT_REQUIRED`,
`CONSENT_VERSION_MISMATCH`, `MONITORING_ALREADY_STOPPED`.

Begin collecting browser activity in the extension **only after** this returns
`monitoring.status: "ACTIVE"`.

### `POST /api/sessions/{session_id}/monitoring/stop`

No body. `200` with the state object. Errors: `409 MONITORING_NOT_STARTED`.

Send any queued events **before** stopping: events are refused once monitoring is `STOPPED`.

### `POST /api/sessions/{session_id}/events`

Send a batch of 1–50 events:

```json
{
  "events": [
    {
      "client_event_id": "6f1c2a8e-4b1d-4c5e-9a77-0c2b9f3d1e10",
      "event_type": "TAB_SWITCH",
      "occurred_at": "2026-11-18T10:05:12.345Z",
      "client_sequence": 0,
      "hostname": "docs.python.org",
      "tab_id": 418
    },
    {
      "client_event_id": "a9d7e0b2-1c3f-4e5a-8b6d-7f8e9a0b1c2d",
      "event_type": "WEBSITE_NAVIGATION",
      "occurred_at": "2026-11-18T10:05:20.001Z",
      "client_sequence": 1,
      "hostname": "chatgpt.com",
      "tab_id": 418
    }
  ]
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `client_event_id` | yes | Unique per event, 8–64 chars `[A-Za-z0-9_-]`. Use `crypto.randomUUID()`. Reuse it when retrying. |
| `event_type` | yes | `TAB_SWITCH` (the active tab changed) or `WEBSITE_NAVIGATION` (the active tab's site changed) |
| `occurred_at` | yes | Browser time, UTC ISO 8601 ending in `Z` (`new Date().toISOString()`) |
| `client_sequence` | yes | Integer ≥ 0. Increment by 1 for every event in this session and keep it in `chrome.storage.local`. Used for ordering instead of the clock. |
| `hostname` | `WEBSITE_NAVIGATION`: yes. `TAB_SWITCH`: optional, `null` for non-web tabs (`chrome://newtab`) | `new URL(tab.url).hostname` only. No scheme, port, path, query, fragment or credentials. Lowercased by the server. Internationalized names must be punycode (which `URL.hostname` already gives). |
| `tab_id` | no | Chrome tab ID, integer ≥ 0 |

Any other field (`url`, `title`, `session_id`, `candidate_id`, ...) is rejected with `422`.
**Never send full URLs, paths, query strings, page titles, keystrokes or screenshots.**

`200 OK`:

```json
{
  "stored": 1,
  "duplicates": 1,
  "results": [
    { "client_event_id": "6f1c2a8e-…", "event_id": "evt_1b2c…", "status": "DUPLICATE" },
    { "client_event_id": "a9d7e0b2-…", "event_id": "evt_9f8e…", "status": "STORED" }
  ]
}
```

- **Retries are safe.** Re-sending an event with the same `client_event_id` and the same content
  returns `DUPLICATE` with the original `event_id` and stores nothing.
- Reusing a `client_event_id` for **different** content: `409 EVENT_ID_CONFLICT`, and nothing in
  that batch is saved.
- The whole batch is validated first. If any event is invalid, nothing is saved (`422`, with
  `details[].location` like `body.events.3.hostname`).
- `occurred_at` must be no earlier than 5 minutes before monitoring started and no later than
  5 minutes in the future (server time): otherwise `422 EVENT_TIMESTAMP_OUT_OF_RANGE`.

Errors: `409 MONITORING_NOT_ACTIVE` (consent not given, not started, or stopped),
`409 EVENT_ID_CONFLICT`, `409 EVENT_LIMIT_REACHED`, `413 PAYLOAD_TOO_LARGE`, `422`,
`429 RATE_LIMITED` (wait `Retry-After` seconds, then resend the same events).

## Employer endpoints (Ada)

Both need `X-Vouch-Dev-Employer`. Read-only.

### `GET /api/sessions/{session_id}/monitoring`

```json
{
  "session_id": "sess_7255a0ce3b844db1b154d2e26429ea73",
  "session_status": "JOINED",
  "candidate": { "candidate_id": "cand_e3668da15ce7439bb5bc1b790ec81db7", "name": "Jordan Lee", "joined_at": "2026-11-18T10:00:00.000000Z" },
  "consent": {
    "status": "GRANTED",
    "consent_version": "2026-11-monitoring-v1",
    "updated_at": "2026-11-18T10:01:00.000000Z",
    "history": [
      { "decision": "DECLINED", "consent_version": null, "recorded_at": "2026-11-18T10:00:30.000000Z" },
      { "decision": "GRANTED", "consent_version": "2026-11-monitoring-v1", "recorded_at": "2026-11-18T10:01:00.000000Z" }
    ]
  },
  "monitoring": {
    "status": "STOPPED",
    "started_at": "2026-11-18T10:01:05.000000Z",
    "stopped_at": "2026-11-18T11:00:00.000000Z",
    "stop_reason": "CANDIDATE_STOPPED",
    "events_received": 42,
    "last_event_received_at": "2026-11-18T10:59:58.000000Z"
  }
}
```

Before anyone joins: `candidate: null`, consent `NONE` with empty `history`, monitoring
`NOT_STARTED`. No candidate token or hash is ever included.

### `GET /api/sessions/{session_id}/events?limit=500&offset=0`

`limit` 1–1000 (default 500), `offset` ≥ 0.

```json
{
  "session_id": "sess_7255a0ce3b844db1b154d2e26429ea73",
  "total_events": 2,
  "limit": 500,
  "offset": 0,
  "events": [
    {
      "event_id": "evt_1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e",
      "event_type": "TAB_SWITCH",
      "hostname": "docs.python.org",
      "tab_id": 418,
      "occurred_at": "2026-11-18T10:05:12.345000Z",
      "received_at": "2026-11-18T10:05:13.002000Z",
      "client_sequence": 0,
      "server_sequence": 17
    }
  ]
}
```

- Ordered by `client_sequence`, then `server_sequence` (the order the server stored them).
  `occurred_at` comes from the candidate's clock and may be off; `received_at` is server time.
- Show these as observed activity only. A tab switch or a visit to a restricted domain is not
  proof of AI use, and the backend makes no such judgment (docs 02 §4D, 04 Feature 5.6).

## Errors

```json
{ "error": { "code": "MONITORING_NOT_ACTIVE", "message": "Human-readable explanation." } }
```

`422` responses also include `details: [{ "location", "message", "type" }]`.

| Status | `code` | Meaning |
| --- | --- | --- |
| 401 | `CANDIDATE_TOKEN_REQUIRED` | No `Authorization: Bearer` header (also sent with `WWW-Authenticate: Bearer`) |
| 401 | `INVALID_CANDIDATE_TOKEN` | Token not recognized |
| 401 | `CANDIDATE_TOKEN_EXPIRED` | Token past `candidate_token_expires_at` |
| 403 | `SESSION_MISMATCH` | Token belongs to a different session than the URL |
| 401 | `DEV_EMPLOYER_REQUIRED` / `DEV_EMPLOYER_INVALID` | Employer header missing or malformed |
| 404 | `SESSION_NOT_FOUND` | Unknown session, or another employer's |
| 409 | `CONSENT_REQUIRED` | Start without granted consent |
| 409 | `CONSENT_VERSION_MISMATCH` | Wrong or outdated disclosure version |
| 409 | `CONSENT_ALREADY_GRANTED` | `DECLINED` after granting (use `WITHDRAWN`) |
| 409 | `CONSENT_NOT_GRANTED` | `WITHDRAWN` without having granted |
| 409 | `MONITORING_NOT_STARTED` | Stop before start |
| 409 | `MONITORING_ALREADY_STOPPED` | Start or grant after monitoring ended |
| 409 | `MONITORING_NOT_ACTIVE` | Events while not `ACTIVE` |
| 409 | `EVENT_ID_CONFLICT` | `client_event_id` reused with different content |
| 409 | `EVENT_LIMIT_REACHED` | Session has 20,000 events |
| 413 | `PAYLOAD_TOO_LARGE` | Events request over 64 KB |
| 422 | `VALIDATION_ERROR` | Bad body or query; see `details` |
| 422 | `EVENT_TIMESTAMP_OUT_OF_RANGE` | `occurred_at` before monitoring started or in the future |
| 429 | `RATE_LIMITED` | Over 600 events per minute; wait `Retry-After` seconds |
| 403 | `FORBIDDEN` | Request not from the same machine |
| 404 | `NOT_FOUND` | Backend not running in dev mode |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VOUCH_ENABLE_DEV_ENDPOINTS` | `false` | Must be `true` for any of these routes to exist |
| `VOUCH_CANDIDATE_TOKEN_TTL_HOURS` | `24` | Candidate token lifetime (1–168) |
| `VOUCH_CONSENT_VERSION` | `2026-11-monitoring-v1` | Disclosure version candidates must consent to. Change it whenever the extension's disclosure text changes. |
| `VOUCH_DATABASE_URL` | `backend/data/vouch.db` | SQLite file (gitignored) |

Fixed limits (in code, `app/core/config.py`): 50 events and 64 KB per request, 600 events per
minute per candidate, 20,000 events per session, 5 minutes of allowed clock difference.

## Upgrading from Milestone 4

- **Delete `backend/data/vouch.db`** before starting this version. The new tables and columns
  can't be added to an old database (no migrations yet). The backend refuses to start with an old
  database and says so. All Milestone 4 test sessions are lost; create new ones.
- Candidates who joined with the Milestone 4 extension have no token and cannot use these
  endpoints. Create a new session and join again with the updated extension.
- The join response only gained fields, so the current extension keeps working; it just doesn't
  store the token yet.
- Session create/list/get responses are unchanged.

## Integration checklist

**Justin (extension)**
1. On join, store `candidate_token`, `session_id` and `required_consent_version` in
   `chrome.storage.local`. Don't display or log the token.
2. Show the disclosure; send `GRANTED` with `required_consent_version`, or `DECLINED`.
   Joining alone must not start anything.
3. Call `monitoring/start`; collect events only once `monitoring.status` is `ACTIVE`.
4. Send `TAB_SWITCH` / `WEBSITE_NAVIGATION` with hostname only, a fresh `client_event_id` and the
   next `client_sequence`. Queue and retry with the same IDs if offline or rate-limited.
5. Flush the queue, then call `monitoring/stop`. Offer "Withdraw consent" (sends `WITHDRAWN`,
   which also stops monitoring).
6. On `401`/`403`, stop collecting and tell the candidate to ask for a new session.
7. On `409 MONITORING_NOT_ACTIVE`, stop collecting and refresh state with `GET .../candidate`.

**Ada (dashboard)**
1. On a session's detail page, call `GET .../monitoring` for consent and monitoring status.
2. Call `GET .../events` for the activity timeline (page with `limit`/`offset`).
3. Label it as observed browser activity, not as AI use or a policy violation.

## Not implemented yet

Production authentication, HTTPS, token refresh or recovery, a "session complete" state and
reports with integrity hashes, retention and deletion, other event types (`TAB_CREATED`,
`TAB_CLOSED`, `INTERVIEW_TAB_INACTIVE`), migrations, and rate limits that survive a restart.
