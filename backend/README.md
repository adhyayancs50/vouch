# backend

API and services for vouch, the privacy-first interview verification system.

Python 3.11+ · FastAPI · Uvicorn · Pydantic v2

## Status

Foundation only: a FastAPI app with a health check, CORS for the local frontend,
and consistent error responses. No product endpoints yet.

### Not yet implemented

- Employer authentication
- Interview sessions, join codes, candidate tokens
- Database storage (SQLite + SQLAlchemy, per docs/03)
- Activity event submission and retrieval
- Session reports and SHA-256 integrity verification

## Layout

```
app/
  main.py              create_app() factory; `app` is the uvicorn entry point
  core/config.py       settings from environment variables (safe defaults)
  core/errors.py       exception handlers -> {"error": {"code", "message"}}
  api/__init__.py      router registration; future routes go under API_PREFIX ("/api")
  api/routes/health.py GET /health
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

To use a local `.env` file: `cp .env.example .env`, then `uvicorn app.main:app --reload --env-file .env`.
Never commit `.env`.

## Errors

Every error response uses the format from docs/05 §7:

```json
{"error": {"code": "NOT_FOUND", "message": "Not Found"}}
```

Validation errors (422) add a `details` list of `{location, message, type}`; submitted values are
never echoed. Unhandled errors return a generic 500 and are logged server-side only.

## Docs

See [system architecture](../docs/02-system-architecture.md) and [API and database documentation](../docs/05-api-and-database-documentation.md).
