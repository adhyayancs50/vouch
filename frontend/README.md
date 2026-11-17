# Vouch frontend

Employer dashboard built with React, TypeScript, Vite, and plain CSS.

## Run locally (Windows PowerShell)

Use Node.js 22.12+ (or a compatible newer LTS), npm, and Python 3.11+.
From the repository root, start the backend in one terminal:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:VOUCH_ENV = "development"
$env:VOUCH_ENABLE_DEV_ENDPOINTS = "true"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

In a second terminal, from the repository root:

```powershell
cd frontend
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

If `.env.local` already exists, update its values instead of overwriting it:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_DEV_EMPLOYER_KEY=test-employer-001
```

Open http://localhost:5173. Vite uses a strict port; stop any other server using 5173.
Restart Vite after environment changes. The backend URL is the root URL, without `/api`.
The backend allows the default frontend origins `http://localhost:5173` and
`http://127.0.0.1:5173` through CORS.

On macOS/Linux, use `python3`, `.venv/bin/python`, `export VOUCH_ENV=development`,
`export VOUCH_ENABLE_DEV_ENDPOINTS=true`, `cp .env.example .env.local`, and `npm`
in place of the corresponding PowerShell commands.

All `VITE_` values are public browser configuration. The employer key is sent as
`X-Vouch-Dev-Employer` on create/list/detail requests. It only separates local test
employers; anyone can set it. **This is not secure authentication.** No login or
production authentication is implemented. Missing configuration produces a helpful
error; the health check remains available without an employer key.

## Features and implementation

- Create Interview accepts a required trimmed title (1–200 characters), an optional
  candidate name (1–120 characters when supplied), and a required AI-use policy:
  `PROHIBITED`, `PARTIALLY_ALLOWED`, or `ALLOWED`.
- Optional domain lists accept commas, spaces or new lines. Entries must be bare
  hostnames such as `chatgpt.com`, without schemes, paths or ports. Lists are limited
  to 50 entries each, normalized to lowercase without leading `www.` or trailing dots,
  and deduplicated. A hostname cannot be both allowed and restricted.
- Creation calls `POST /api/sessions`. The returned join code is prominently displayed
  with Copy Code and an explicit dismissal. Save it before dismissing or reloading.
  It is held only in temporary React state, separately from list/detail data; it is
  never written to localStorage/sessionStorage, logged, or included in URLs. Copy Code
  writes it to the clipboard only on request; manual copying is available if the
  browser denies clipboard access. Another creation is disabled until code dismissal.
- `GET /api/sessions` loads on entry and after creation. The table includes title,
  candidate name, AI-use policy, status, creation date and join-code expiration.
  Loading, retryable errors, and the existing empty-state illustration are supported.
- Select an interview title for `GET /api/sessions/{session_id}` details, including
  the policy domain lists and joined candidate name/ID/time when available. Details
  never request or display a recovered join code. Use Refresh sessions or Refresh
  details to check for candidate joins; there is no automatic polling.
- Dates use the browser's local timezone. Existing navigation, About Vouch, privacy
  information, responsive styling, and Test Backend Connection are preserved.
- `src/api.ts` remains the shared JSON utility, extended for employer GET/POST
  requests and structured errors, with a ten-second timeout. Known backend error
  codes map to helpful messages without echoing potentially sensitive response
  messages or validation details. Unknown/non-JSON failures have safe fallbacks.
- Creation is never automatically retried: a network failure may occur after the
  backend creates a session, and a lost plaintext code cannot be recovered.

## Verify locally

```powershell
cd frontend
npm.cmd test
npm.cmd run build
```

The tests use Node's built-in test runner and Vite's existing TypeScript loader;
no test dependencies were added. They cover hostname rules, request bodies and
headers, separation of the creation code, list/detail responses, structured errors,
network/JSON/timeout failures, and health-check behavior. Fetch is mocked: these
are **not live backend or browser integration tests**. The build runs TypeScript
checks and produces `dist/`. There was no existing frontend test suite.

With both servers running, manually check:

1. Click **Test Backend Connection**; confirm the success message and `GET /health`.
2. For a new employer with no sessions, confirm the empty state. Click **Create
   Interview**, leave required fields blank, and verify validation prevents submission.
3. Create “Backend Engineer Interview” for “Jordan Lee” with **Partially allowed**,
   allowed `docs.python.org`, and restricted `chatgpt.com, claude.ai`. Confirm HTTP 201
   and the employer header in Network. Do not record/share the response's real code.
4. Confirm the one-time code appears. Click **Copy Code** and paste into a private
   temporary location to verify it; clear the clipboard afterward if desired. Dismiss
   the notice, reload, and confirm the code is absent from the list, details, browser
   storage and URL. A reload before saving also loses access to the code.
5. Check all six list columns. Open the interview title and check the full policy,
   candidate name, CREATED status and dates. Repeat with the optional name/domains
   blank and each AI-use policy. Try URLs, paths, ports, overlapping lists (including
   `www.`/case variants), whitespace-only titles and more than 50 domains.
6. To verify JOINED details, use the extension or `POST /api/sessions/join` as described
   in [the API contract](../backend/API_SESSIONS.md). Send the code only in its JSON
   body; never in the URL. Refresh sessions/details and check the joined candidate.
7. Stop the backend and refresh/test the connection; errors should appear and retry
   should recover after restart. Run the backend without development endpoints to
   check the 404 setup guidance. An empty `VITE_DEV_EMPLOYER_KEY` should show the
   missing-configuration message; an invalid value such as `bad key` should show the
   401 guidance after restarting Vite. Restore `test-employer-001` afterward.
8. Check keyboard navigation and a narrow mobile viewport. Confirm the table scrolls
   horizontally, the form stacks, and the existing About Vouch links still work.

No reporting, monitoring, session deletion, join-code regeneration, or production
authentication is implemented. See [the session contract](../backend/API_SESSIONS.md)
and [feature specifications](../docs/04-feature-specifications.md) for backend scope.
