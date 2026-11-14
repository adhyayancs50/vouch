# Session API contract (Milestone 4)

For **Ada** (employer dashboard) and **Justin** (Chrome extension). Owner: Srihith (backend).

> **Development only.** There is no real login yet. These endpoints exist only when the backend
> runs with `VOUCH_ENABLE_DEV_ENDPOINTS=true`, only answer requests from the same machine, and
> identify employers with a header anyone can set. Do not deploy them or treat them as secure.

## Run the backend

From `backend/`:

```bash
pip install -r requirements.txt
VOUCH_ENABLE_DEV_ENDPOINTS=true uvicorn app.main:app --reload
```

- Base URL: `http://127.0.0.1:8000` (use `127.0.0.1`, not `localhost`)
- Sessions are stored in `backend/data/vouch.db` (SQLite, gitignored) and survive restarts.
- After pulling a backend change to the database tables, delete `backend/data/vouch.db`
  (there are no migrations yet).
- Without the flag every `/api/sessions` route returns `404`.

## Conventions

- JSON in and out. Send `Content-Type: application/json` on POST.
- Timestamps are UTC ISO 8601 ending in `Z`, e.g. `2026-11-14T05:13:32.317360Z`.
- Unknown request fields are rejected with `422`.
- Every error has this shape:

```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "Human-readable explanation." } }
```

`422` errors also include `details: [{ "location": "body.title", "message": "...", "type": "..." }]`.
Show `message` to users; branch on `code` in code.

## Employer identity (Ada)

The three employer endpoints need this header:

```
X-Vouch-Dev-Employer: acme-hr
```

- 1–64 characters: letters, digits, `.`, `_`, `-`.
- Any value works; the first request with a new value creates that development employer.
- Each employer only sees its own sessions. Use one fixed value in the dashboard for now
  (for example from a `VITE_DEV_EMPLOYER` setting).
- Missing or invalid header: `401` with code `DEV_EMPLOYER_REQUIRED` or `DEV_EMPLOYER_INVALID`.
- CORS allows this header from `http://localhost:5173` and `http://127.0.0.1:5173`.

This is a stand-in until real employer accounts and login exist (doc 04, Feature 5.1).

## Session object

Returned by create, list and get:

```json
{
  "session_id": "sess_7255a0ce3b844db1b154d2e26429ea73",
  "title": "Backend Engineer Interview",
  "candidate_name": "Jordan Lee",
  "status": "CREATED",
  "policy": {
    "ai_usage": "PARTIALLY_ALLOWED",
    "allowed_domains": ["docs.python.org"],
    "restricted_domains": ["chatgpt.com", "claude.ai"]
  },
  "created_at": "2026-11-14T05:13:32.317360Z",
  "join_code_expires_at": "2026-11-17T05:13:32.317360Z",
  "joined_at": null,
  "candidate": null
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `session_id` | string | `sess_` + 32 hex characters |
| `title` | string | 1–200 characters |
| `candidate_name` | string or null | Name the employer entered, if any |
| `status` | `"CREATED"` or `"JOINED"` | More states arrive in later milestones |
| `policy.ai_usage` | `"PROHIBITED"`, `"PARTIALLY_ALLOWED"`, `"ALLOWED"` | |
| `policy.allowed_domains` | string[] | Lowercase hostnames |
| `policy.restricted_domains` | string[] | Lowercase hostnames |
| `created_at` | timestamp | |
| `join_code_expires_at` | timestamp | 72 hours after creation by default |
| `joined_at` | timestamp or null | Set when the candidate joins |
| `candidate` | object or null | `{ "candidate_id": "cand_…", "name": "Jordan Lee", "joined_at": "…Z" }` after joining |

The join code is **not** part of this object. It is returned once, by create.

## 1. Create a session (Ada)

`POST /api/sessions` with the `X-Vouch-Dev-Employer` header.

```json
{
  "title": "Backend Engineer Interview",
  "candidate_name": "Jordan Lee",
  "policy": {
    "ai_usage": "PARTIALLY_ALLOWED",
    "allowed_domains": ["docs.python.org"],
    "restricted_domains": ["chatgpt.com", "claude.ai"]
  }
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `title` | yes | 1–200 characters after trimming |
| `candidate_name` | no | 1–120 characters; omit or send `null` if unknown |
| `policy.ai_usage` | yes | `PROHIBITED`, `PARTIALLY_ALLOWED` or `ALLOWED` (uppercase) |
| `policy.allowed_domains` | no | Up to 50 bare hostnames, e.g. `github.com`. No `https://`, path or port. |
| `policy.restricted_domains` | no | Same rules. A domain cannot be in both lists. |

Domains are lowercased, a leading `www.` is dropped, and duplicates are removed.

**`201 Created`**: the session object plus the plaintext join code:

```json
{
  "session_id": "sess_7255a0ce3b844db1b154d2e26429ea73",
  "...": "all session fields above",
  "candidate_join_code": "SWY8-BSFT-3XS6-F4GH"
}
```

`candidate_join_code` is shown **only in this response**. The server stores a hash and cannot
show it again. The dashboard should display it right away with a copy button and say it won't
be shown again. Don't put it in a URL, `localStorage` or logs.

Errors: `401` (employer header), `422` `VALIDATION_ERROR`.

## 2. List sessions (Ada)

`GET /api/sessions` with the `X-Vouch-Dev-Employer` header.

**`200 OK`**, newest first, only this employer's sessions, never any join code:

```json
{ "total_sessions": 1, "sessions": [ { "session_id": "sess_…", "...": "session object" } ] }
```

Errors: `401` (employer header).

## 3. Get one session (Ada)

`GET /api/sessions/{session_id}` with the `X-Vouch-Dev-Employer` header.

**`200 OK`**: the session object. After the candidate joins, `status` is `JOINED` and `candidate`
is filled in, so polling this shows when the candidate has joined.

Errors: `401` (employer header), `404` `SESSION_NOT_FOUND` (unknown ID, or another employer's session).

## 4. Join a session (Justin)

`POST /api/sessions/join`. **No employer header.** The join code is the credential.

```json
{ "join_code": "SWY8-BSFT-3XS6-F4GH", "candidate_name": "Jordan Lee" }
```

| Field | Required | Rules |
| --- | --- | --- |
| `join_code` | yes | As the employer gave it. Case, spaces and hyphens don't matter: `swy8bsft3xs6f4gh` works. |
| `candidate_name` | no | 1–120 characters. Defaults to the name the employer entered. |

Send the code only in the request body, never in the URL.

**`200 OK`**:

```json
{
  "success": true,
  "session_id": "sess_7255a0ce3b844db1b154d2e26429ea73",
  "title": "Backend Engineer Interview",
  "status": "JOINED",
  "policy": {
    "ai_usage": "PARTIALLY_ALLOWED",
    "allowed_domains": ["docs.python.org"],
    "restricted_domains": ["chatgpt.com", "claude.ai"]
  },
  "candidate_id": "cand_e3668da15ce7439bb5bc1b790ec81db7",
  "candidate_name": "Jordan Lee",
  "joined_at": "2026-11-14T05:13:32.404724Z"
}
```

Store `session_id` and `candidate_id` in `chrome.storage.local`; later milestones will use them.
Show `policy` to the candidate before consent (doc 04, Feature 6.3).

**Errors:**

| Status | `code` | When | What the extension should show |
| --- | --- | --- | --- |
| `401` | `INVALID_JOIN_CODE` | Code doesn't match any session (or is the wrong shape) | "Check the code and try again" |
| `409` | `SESSION_ALREADY_JOINED` | The code was already used | "This code was already used. Ask the employer for a new session." |
| `410` | `JOIN_CODE_EXPIRED` | Past `join_code_expires_at` | "This code has expired. Ask the employer for a new session." |
| `429` | `TOO_MANY_ATTEMPTS` | 10 wrong codes in 15 minutes | Wait the number of seconds in the `Retry-After` header |
| `422` | `VALIDATION_ERROR` | Missing/empty `join_code`, extra fields | Fix the request |

**Codes are single-use.** Once a candidate joins, the same code returns `409`, even for the same
candidate. To test again, create a new session. Re-joining with a candidate credential is planned
for the session-start milestone.

## Join codes

- 16 characters in 4 groups, e.g. `SWY8-BSFT-3XS6-F4GH`, from `ABCDEFGHJKMNPQRSTVWXYZ23456789`
  (no `0/O`, `1/I/L` or `U`, so they're easy to read aloud).
- About 78 bits of randomness from Python's `secrets` module.
- Stored only as a SHA-256 hash. Never logged, never in list/get responses.
- Expire after 72 hours by default (`VOUCH_JOIN_CODE_TTL_HOURS`, 1–720).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VOUCH_ENABLE_DEV_ENDPOINTS` | `false` | Must be `true` for any `/api/sessions` route to exist |
| `VOUCH_DATABASE_URL` | `sqlite:///<backend>/data/vouch.db` | SQLAlchemy URL for the database |
| `VOUCH_JOIN_CODE_TTL_HOURS` | `72` | How long a join code stays valid |

Extension: the existing `"host_permissions": ["http://127.0.0.1:8000/*"]` already covers these
endpoints. Dashboard: no backend config needed beyond the default CORS origins.

## Not implemented yet

Production login, candidate tokens, session start/consent (`ACTIVE`), activity events for real
sessions, completion, reports, regenerating a join code, and deleting sessions.
