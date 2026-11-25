# Current context

Last verified: 2026-11-22, against `main` after Milestone 5. This file records what is built now. Endpoint and schema details stay in the API contracts.

## Built

- Employer dashboard: create, list, and read interview sessions. The one-time join code stays in memory until the employer dismisses it. Milestone 5 Phase 3 adds read-only consent/monitoring snapshots and a paginated, sequence-ordered browser activity timeline in session details, with manual refresh, fetch timestamps, independent error handling, and employer policy presented separately. Activity is not scored or automatically classified as a policy violation. Frontend build and mocked-fetch/server-rendered tests verified on the feature branch on 2026-11-25; browser integration checks remain manual.
- Backend, development mode only: sessions, one-time join codes, candidate bearer tokens, consent, monitoring, and browser events. Tables are created on startup. There are no migrations.
- Chrome extension 0.2.0: join, consent, start, stop, withdraw, and submit hostname-only activity while the popup is closed. A collapsed popup control still sends one synthetic `EXTENSION_CONNECTED` event to `/api/dev/events`.

## Not built

Employer login, HTTPS, token refresh, session completion, reports, report integrity hashes, retention and deletion, database migrations, and event types other than `TAB_SWITCH` and `WEBSITE_NAVIGATION`.

## Decisions that are easy to lose

- Consent and monitoring are separate. Granting consent does not start collection. `STOPPED` never returns to `ACTIVE`.
- The server assigns `received_at` and `monitoring_stopped_at` only after the SQLite write lock is held. Write transactions start with `BEGIN IMMEDIATE`. An event committed while monitoring is `ACTIVE` is kept. After stop or withdrawal commits, later events are rejected and are not stored.
- Candidate identity comes from the bearer token. A `session_id` or `candidate_id` in an event body is rejected.
- The extension base URL and manifest host permission are both `http://127.0.0.1:8000`.
- Changing the disclosure text requires a new `VOUCH_CONSENT_VERSION`.
- Frontend environment variables are public. `VITE_DEV_EMPLOYER_KEY` is read when Vite starts.

## Read next

- `backend/API_SESSIONS.md`
- `backend/API_MONITORING.md`
- The README in the component you are changing

## Update this file

Update it in the same pull request that changes the snapshot above. Adjust "Built", "Not built", or "Decisions". Advance "Last verified" to the merge date. Do not paste API tables here. If a planning document disagrees with this file, add one line under "Decisions" or "Not built" rather than rewriting `docs/01` through `docs/06` in the same change.
