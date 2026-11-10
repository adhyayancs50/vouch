# Security notes — DRAFT

> **DRAFT — for review with Javier; nothing here is implemented.**
> Points marked *(docs)* restate the agreed docs with a section reference. Points marked
> *(recommendation)* are backend proposals that still need security and team agreement.

## 1. Activity event contents

Fields per event *(docs: 05 API 5.1, Table 3)*:

| Field | Set by | Notes |
| --- | --- | --- |
| `event_id` | extension | Unique; used for deduplication on retry *(05 API 5.1)* |
| `session_id` | path parameter | Must match the session the candidate token is scoped to |
| `event_type` | extension | One of the five types below |
| `timestamp` | extension | When the event happened; UTC ISO-8601 *(05 §3, §15)* |
| `received_at` | **server** | When the backend received it; never accepted from the client *(05 Table 3, §15)* |
| `metadata` | extension | Minimum necessary only *(05 Table 3 rules)* |

Event types *(docs: 05 API 5.1)* and proposed minimal metadata *(recommendation)*:

| `event_type` | Proposed `metadata` |
| --- | --- |
| `TAB_SWITCH` | `active_tab_id`, `previous_tab_id` (integers; matches the 05 example) |
| `TAB_CREATED` | `tab_id` |
| `TAB_CLOSED` | `tab_id` |
| `WEBSITE_NAVIGATION` | `tab_id`, `domain` (hostname only, e.g. `example.com`) |
| `INTERVIEW_TAB_INACTIVE` | `interview_tab_id`, optionally `active_tab_id` |

Tab IDs are Chrome's per-browser-session integers and are not personal data on their own.

## 2. Never collected

*(docs: 02 §2E, 04 Feature 6.5)*: keystrokes; screen recordings; contents of web pages;
unrelated personal files; any claim of monitoring outside the supported browser.

*(recommendation)* Also never accept or store:

- Full URLs, paths, query strings or fragments (these often carry search terms, tokens, emails)
- Page titles
- Cookies, local storage, form data, clipboard contents
- Browser history from before the session started, or other installed extensions
- Screenshots or DOM snapshots
- Client IP addresses or device fingerprints in event records (server access logs are a
  separate retention question)

The backend should **reject** events containing such fields rather than silently drop them,
so extension bugs surface early.

## 3. Consent representation

*(docs: 05 Table 5, API 4.4, 04 Feature 6.3)*:

- `session_consents` row: `session_id`, `consent_given` (bool), `consent_version` (string),
  `consented_at` (server-set UTC time).
- `POST /api/sessions/{id}/start` carries `{"consent_given": true, "consent_version": "1.0"}`
  and the candidate token.
- The backend must not move a session to `ACTIVE` without a valid consent record; declining
  starts nothing.

*(recommendation / open)*:

- Store a SHA-256 hash of the exact policy and disclosure text the candidate saw, alongside
  `consent_version`, so a report can show what was agreed to even if wording later changes.
- Reject `consent_given: false` on `/start` with 409/422 rather than storing a "declined" row,
  unless the team wants declines recorded for the employer.
- Include the consent record (version, time, policy hash) in the hashed report.

## 4. Event validation checklist

Before storing an event *(docs: 05 §16, API 5.1, 04 Feature 7.2)*:

1. Candidate token present (Authorization header), valid, unexpired, scoped to this session → else 401/403.
2. Session exists → else 404.
3. Session status is `ACTIVE` → else 409 (covers completed/interrupted/expired).
4. `event_id` present; if already stored for this session, return the original acknowledgement
   and do not insert a duplicate.
5. `event_type` is one of the five supported types → else 422.
6. `timestamp` is valid ISO-8601 with UTC (`Z` or `+00:00`) → else 422.
7. `metadata` matches the schema for that `event_type` → else 422.
8. Set `received_at` on the server; store; return 201.

*(recommendation)* additionally:

- Strict metadata schemas per type: reject unknown keys (Pydantic `extra="forbid"`).
- Maximum request body size (e.g. 16 KB per event) and string length limits on `domain`.
- Validate `domain` as a hostname (no scheme, path, port or credentials); lowercase it.
- Clock-skew bounds: reject or flag timestamps before `started_at` minus a small tolerance, or
  more than ~2 minutes in the future. Late-arriving events (queued offline) are expected, so
  flag rather than reject based on `received_at - timestamp`.
- Per-token rate limiting to stop event flooding.
- Never log the candidate token or full request bodies.

## 5. Open questions for Javier and the team

1. **URL vs domain** — 04 Feature 6.5 says "permitted URL or domain information". Recommend
   domain only for the MVP. Agree?
2. **Employer auth before P1 accounts** — 04 Feature 5.1 allows a temporary dev account, but 05
   says employer endpoints must be restricted to the owner. Proposed stopgap: a single dev API
   key from an env var, removed when real auth lands.
3. **Report signing** — 04 §7.6 and 05 Table 4 note SHA-256 alone doesn't stop someone who can edit
   both the report and its hash. Is a signature with a separately stored key in MVP scope or later?
4. **Candidate token format and lifetime** — opaque random token stored hashed, or signed (JWT)?
   What expiry? *(05 API 4.3 requires expiry and session scoping but doesn't specify.)*
5. **Interrupted sessions** — what signal marks a session `INTERRUPTED` (heartbeat timeout,
   extension-reported gap)? *(02 §8, 05 Table 2.)*
6. **Event ID format** — UUIDv4 from the extension? Should uniqueness be per session or global?
   (05 Table 3 says "unique within the database".)
7. **Policy-based flagging** — should the report mark visits to `restricted_domains` as "may
   warrant review"? 02 §4D and 04 Feature 5.6 say events must not be labelled as cheating.
