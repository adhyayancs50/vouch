# backend

API and services for vouch, the privacy-first interview verification system.

Python 3.11+ · FastAPI · Uvicorn · Pydantic v2

## Status

Foundation: a FastAPI app with a health check, CORS for the local frontend,
and consistent error responses. No product endpoints yet.

Development mode (off by default) adds:

- `/api/dev/events`: in-memory extension test events (Milestone 3). See
  [Development test events](#development-test-events-local-only).
- `/api/sessions`: interview sessions and candidate join codes stored in SQLite (Milestone 4).
  See [Interview sessions](#interview-sessions-development-only) and the full contract in
  [`API_SESSIONS.md`](API_SESSIONS.md).

There is **no production authentication** yet, so none of these routes may be enabled outside
local development.

### Not yet implemented

- Employer authentication (a development header stands in for it)
- Candidate tokens, session start/consent, completion
- Database migrations (tables are created on startup)
- Activity event submission and retrieval for real sessions
- Session reports and SHA-256 integrity verification

## Layout

```
app/
  main.py              create_app() factory; `app` is the uvicorn entry point
  core/config.py       settings from environment variables (safe defaults)
  core/errors.py       exception handlers -> {"error": {"code", "message"}}
  api/__init__.py      router registration; future routes go under API_PREFIX ("/api")
  api/routes/health.py GET /health
  core/access.py       local-only guard and development employer identity
  db/__init__.py       SQLAlchemy engine, UTC datetimes, table creation
  dev/events.py        POST/GET /api/dev/events (dev mode only, in-memory)
  sessions/            /api/sessions: models, schemas, join codes, routes (dev mode only)
data/vouch.db          local SQLite database (gitignored, created in dev mode)
API_SESSIONS.md        session API contract for the dashboard and extension
tests/                 pytest suite
SECURITY_NOTES_DRAFT.md  draft event/consent/validation rules for review with security
```

## Setup

Run all commands from `backend/`.

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

Windows (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
```

`requirements.txt` holds runtime dependencies; `requirements-dev.txt` adds pytest and httpx.

## Run

```bash
uvicorn app.main:app --reload
```

- Health check: http://127.0.0.1:8000/health returns `{"status": "healthy", "service": "vouch-backend"}`
- API docs: http://127.0.0.1:8000/docs

## Test

```bash
pytest -q
```

## Configuration

All settings are optional environment variables; see [`.env.example`](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `VOUCH_ENV` | `development` | Environment name |
| `VOUCH_LOG_LEVEL` | `INFO` | Python log level |
| `VOUCH_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated allowed origins (`*` rejected) |
| `VOUCH_ENABLE_DEV_ENDPOINTS` | `false` | Enables `/api/dev/events`. Startup fails if `true` while `VOUCH_ENV` is not `development` |
| `VOUCH_EXTENSION_ORIGINS` | *(empty)* | Exact `chrome-extension://<id>` origins allowed by CORS, dev mode only (wildcards rejected) |
| `VOUCH_DATABASE_URL` | `sqlite:///<backend>/data/vouch.db` | SQLAlchemy database URL (used in dev mode) |
| `VOUCH_JOIN_CODE_TTL_HOURS` | `72` | Hours a candidate join code stays valid (1–720) |

To use a local `.env` file: `cp .env.example .env`, then `uvicorn app.main:app --reload --env-file .env`.
Never commit `.env`.

## Development test events (local only)

Temporary endpoints for Milestone 3 (Chrome extension to backend). **Not** the product event API
from docs/05: no sessions, no tokens, no database. Events live in memory (newest 1,000) and are lost
on restart.

Safeguards:

- Off unless `VOUCH_ENABLE_DEV_ENDPOINTS=true`; when off, the routes do not exist (404).
- The server refuses to start if dev endpoints are enabled with `VOUCH_ENV` other than `development`.
- Requests from anything other than the local machine get `403`, even if uvicorn is bound to `0.0.0.0`.
- Only `EXTENSION_CONNECTED` events are accepted; unknown fields are rejected; `metadata` is capped at 4 KB.

### Enable

macOS / Linux:

```bash
VOUCH_ENABLE_DEV_ENDPOINTS=true uvicorn app.main:app --reload
```

Windows (PowerShell):

```powershell
$env:VOUCH_ENABLE_DEV_ENDPOINTS="true"; uvicorn app.main:app --reload
```

The startup log shows `Development endpoints are ENABLED (/api/dev/*)`.

### `POST /api/dev/events`

```json
{
  "session_id": "dev-session-1",
  "event_type": "EXTENSION_CONNECTED",
  "timestamp": "2026-11-12T20:30:00Z",
  "metadata": {"extension_version": "0.1.0"}
}
```

| Field | Rules |
| --- | --- |
| `session_id` | string, 1–128 characters |
| `event_type` | `EXTENSION_CONNECTED` only |
| `timestamp` | ISO 8601 string in UTC (`Z` or `+00:00`); naive, non-UTC or numeric values rejected |
| `metadata` | JSON object (may be `{}`), at most 4 KB |

`201 Created`:

```json
{"success": true, "event_id": "evt_35fe4eeace2b49768f656aef4eb549fa", "session_id": "dev-session-1", "message": "Development test event stored."}
```

Invalid payloads return `422` with `{"error": {"code": "VALIDATION_ERROR", "message": ..., "details": [...]}}`.

### `GET /api/dev/events`

`200 OK`, oldest first by `timestamp`:

```json
{"total_events": 1, "events": [{"event_id": "evt_...", "session_id": "dev-session-1", "event_type": "EXTENSION_CONNECTED", "timestamp": "2026-11-12T20:30:00Z", "received_at": "2026-11-12T20:30:01.123456Z", "metadata": {"extension_version": "0.1.0"}}]}
```

### Try it

```bash
curl -s -X POST http://127.0.0.1:8000/api/dev/events -H "Content-Type: application/json" \
  -d '{"session_id":"dev-session-1","event_type":"EXTENSION_CONNECTED","timestamp":"2026-11-12T20:30:00Z","metadata":{}}'
curl -s http://127.0.0.1:8000/api/dev/events
```

Or use http://127.0.0.1:8000/docs, where the endpoints appear under **development** in dev mode.

### Chrome extension (Manifest V3) access

A request from an MV3 extension carries the origin `chrome-extension://<extension-id>`, not a
localhost origin, so the frontend CORS settings do not cover it. Either:

1. **Recommended:** add `"host_permissions": ["http://127.0.0.1:8000/*"]` to the extension's
   `manifest.json`. Chrome then lets the extension call the backend without CORS, and it works
   on every teammate's machine with no backend config.
2. Or keep the manifest as is and allow that extension's exact origin:
   `VOUCH_EXTENSION_ORIGINS=chrome-extension://<id>` (the ID is shown on `chrome://extensions`).
   An unpacked extension's ID depends on its folder path, so each developer sets their own.

Use `http://127.0.0.1:8000` (not `localhost`) so it matches the host permission.

## Interview sessions (development only)

Milestone 4. Employers create sessions with an AI-use policy; candidates join with a one-time
code. Full request/response contract: [`API_SESSIONS.md`](API_SESSIONS.md).

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/sessions` | Employer | Create a session; returns the join code once |
| `GET` | `/api/sessions` | Employer | List this employer's sessions |
| `GET` | `/api/sessions/{session_id}` | Employer | One session, including whether the candidate joined |
| `POST` | `/api/sessions/join` | Candidate | Validate a join code; session moves `CREATED` → `JOINED` |

Limitations, by design for the development MVP:

- **No real employer login.** Employer endpoints take an `X-Vouch-Dev-Employer: <key>` header.
  Anyone on the machine can send any key; it only keeps test employers apart.
- Same safeguards as the dev events: off unless `VOUCH_ENABLE_DEV_ENDPOINTS=true`, refused unless
  `VOUCH_ENV=development`, local requests only.
- Join codes are random (about 78 bits), stored only as SHA-256 hashes, single-use, expire after
  72 hours, and never appear in URLs, logs or list responses.
- Failed joins are limited to 10 per client per 15 minutes (in memory; resets on restart).
- Tables are created on startup with no migrations: delete `data/vouch.db` after a schema change.

Try it (dev mode on):

```bash
curl -s -X POST http://127.0.0.1:8000/api/sessions -H "Content-Type: application/json" \
  -H "X-Vouch-Dev-Employer: acme-hr" \
  -d '{"title":"Backend Engineer Interview","policy":{"ai_usage":"PROHIBITED","restricted_domains":["chatgpt.com"]}}'
curl -s http://127.0.0.1:8000/api/sessions -H "X-Vouch-Dev-Employer: acme-hr"
curl -s -X POST http://127.0.0.1:8000/api/sessions/join -H "Content-Type: application/json" \
  -d '{"join_code":"<code from the create response>"}'
```

## Errors

Every error response uses the format from docs/05 §7:

```json
{"error": {"code": "NOT_FOUND", "message": "Not Found"}}
```

Validation errors (422) add a `details` list of `{location, message, type}`; submitted values are
never echoed. Unhandled errors return a generic 500 and are logged server-side only.

## Docs

See [system architecture](../docs/02-system-architecture.md) and [API and database documentation](../docs/05-api-and-database-documentation.md).
