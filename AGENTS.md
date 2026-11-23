# Vouch agent instructions

Vouch is a local, privacy-first interview verification app. The employer dashboard and the Chrome extension communicate only through the FastAPI backend.

## Where the truth is

- Current behavior: `docs/CONTEXT.md`.
- Session API: `backend/API_SESSIONS.md`.
- Consent, monitoring, and events: `backend/API_MONITORING.md`.
- Setup and commands: `backend/README.md`, `frontend/README.md`, `extension/README.md`.

`docs/01` through `docs/06` are planning documents. `backend/SECURITY_NOTES_DRAFT.md` is an unadopted draft. When either disagrees with the contracts or the code, follow the contracts and the code.

## Scope

- Change only the component named in the task.
- Do not add production authentication, HTTPS, reports, migrations, or new event types unless the task asks for them.
- Preserve the API error shape `{ "error": { "code", "message" } }`. Validation errors may include `details`. Do not echo submitted secrets or join codes.
- Update the matching API contract when a request, response, or error code changes. Do not duplicate that contract in this file or in `docs/CONTEXT.md`.

## Privacy and local development

- Development routes exist only when `VOUCH_ENABLE_DEV_ENDPOINTS=true` and `VOUCH_ENV=development`. Leave them off by default.
- `X-Vouch-Dev-Employer` is a local label, not authentication.
- Joining is not consent. Collect browser activity only after the backend reports monitoring `ACTIVE`.
- `STOPPED` is final. Consent withdrawal stops active monitoring.
- Store and transmit hostnames only. Reject full URLs, paths, queries, fragments, titles, page contents, keystrokes, and screenshots.
- Keep join codes and candidate tokens out of URLs, logs, and list responses. The extension stores its token in `chrome.storage.local`, not `chrome.storage.sync`.
- Call the backend at `http://127.0.0.1:8000`. The extension host permission does not cover `localhost`.
- Do not commit `.env`, `.env.local`, credentials, or `backend/data/vouch.db`. Do not delete that database unless the user explicitly asks.

## Checks

Run the suite for every component you change.

- Backend, from `backend/`: `pytest -q`
- Frontend, from `frontend/`: `npm test` and `npm run build` when types or the UI change
- Extension, from the repository root: `node --test extension/tests/*.test.mjs`

Backend tests must keep using their temporary database. Do not point them at `backend/data/vouch.db`.

## Git

Work on a feature branch. Do not push or merge to `main` unless the user asks. Stage only files that belong to the task.

## After a milestone

Update `docs/CONTEXT.md` in the milestone pull request when the milestone changes what is built, what is not built, or a decision listed there. Change this file only when a durable rule changes. Leave `docs/01` through `docs/06` unchanged unless the task is to revise those planning documents.
