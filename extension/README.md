# extension

Browser extension for vouch, the privacy-first interview verification system.

## Status

Manifest V3 extension with candidate interview joining, saved interview details and AI-use policy, and a manual backend connection test. Joining does not start monitoring or give consent to tracking. The earlier consent-based local recording prototype is kept in a separate disclosure. No build step or extension dependencies are required.

## Join an interview (Milestone 4)

1. From the project root, start the latest backend on the same computer as Chrome:

   ```sh
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   python3 -m pip install -r requirements.txt
   VOUCH_ENABLE_DEV_ENDPOINTS=true python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

   Leave this terminal running. `/api/sessions` requires the dev flag. See
   [the session API contract](../backend/API_SESSIONS.md) for backend setup.
2. Create an interview in the employer dashboard and copy its one-time join code.
   Alternatively, run this command in another terminal to create a fresh test interview:

   ```sh
   curl --noproxy '*' --max-time 10 -sS -X POST http://127.0.0.1:8000/api/sessions \
     -H 'Content-Type: application/json' \
     -H 'X-Vouch-Dev-Employer: extension-test' \
     -d '{"title":"Extension join test","candidate_name":"Jordan Lee","policy":{"ai_usage":"PARTIALLY_ALLOWED","allowed_domains":["docs.python.org"],"restricted_domains":["chatgpt.com","claude.ai"]}}'
   ```

   Copy `candidate_join_code` from that response. Each successful join consumes
   the code; create a new interview for another successful test.
3. Open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
   Select the project's **`extension/`** directory, which contains `manifest.json`.
   If Vouch is already loaded, stop any local recording test, click **Reload**,
   and close/reopen the popup.
4. Enter the code and, optionally, your name; click **Join Session**. Case,
   hyphens, and spaces are handled by the backend. Keep the popup open until
   confirmation. The candidate request sends no employer header.
5. Verify **Joined**, the interview title, candidate name when available, the
   AI-use policy, and both domain lists. An empty list shows **None specified**.
   Joining sends no recording command and uploads no browser records.
6. Close/reopen the popup. The saved confirmation should reappear without a
   network request. This is a local snapshot, not an authenticated resume or
   a live check of the interview's current backend status.

### Error and privacy checks

- Submit an empty/space-only code: a message appears without making a request.
  A blank optional name is omitted from the request.
- Click **Clear saved interview**, then submit the used code: expect the
  already-used message (409). Clearing details never makes a code reusable.
- Submit `AAAA-AAAA-AAAA-AAAA`: expect an invalid-code message (401).
- Expired codes show a new-session instruction (410); validation errors (422),
  nonlocal requests (403), missing/disabled session endpoints (404), connection
  failures, and server errors each show a readable message without tracebacks.
- A 429 disables joining for `Retry-After`, with a countdown. The cooldown is
  saved across popup closure; both seconds and HTTP-date headers are supported.
  An absent/invalid header uses a one-minute UI cooldown. The backend enforces
  its own limit independently.
- Double clicking/pressing Enter while a join is pending sends one request.
  No join is retried automatically.
- If the popup closes, the network fails, or it times out before confirmation
  is saved, the backend may already have accepted the code. Ask the employer
  to check; do not assume the same single-use code can be used again.

`chrome.storage.local.joinedInterview` contains only the confirmed session and
candidate IDs, interview title, candidate name, joined status/time, and policy.
The plaintext code is never saved or logged and is cleared from the input on
success or an uncertain network outcome. No token is assumed or saved.
**Clear saved interview** removes this local snapshot, not the backend session.
If Chrome storage fails, confirmed details remain visible for the current
popup and a warning explains that closing it will lose them.

The existing `storage` and loopback host permissions cover joining. No new
permissions, tracking listeners, automatic monitoring, or resume endpoint were added.

### Automated extension checks

With Node.js available, run from the project root:

```sh
node --test extension/tests/join-session.test.mjs
```

These dependency-free controller/DOM tests exercise joining, policy rendering,
error responses, loading/duplicate protection, rate limits, persistence and
storage failures, text safety, and coexistence with the existing development tools.

## Try the separate local recording prototype

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**, click **Load unpacked**, and select this `extension/` folder.
3. Open Vouch from Chrome's extensions menu.
4. Expand **Local recording prototype**, accept its recording notice, and click **Start test session**.
5. Close the popup and switch tabs a few times.
6. Reopen Vouch and expand **View local records**.
7. Click **Stop**, switch tabs again, and confirm the count stays unchanged.

Before consent and Start, no events should be recorded. Reopening the popup should preserve session status. Records include tab IDs and UTC timestamps, without URLs or page contents. Records remain in `chrome.storage.local`; starting a new test clears previous records. Tracking stops at 1,000 records or on browser restart. This prototype observes tab activation across the current Chrome profile; window-focus changes alone are not recorded.

After editing the code, click the extension's reload button in `chrome://extensions`. Treat reloads/updates as development interruptions and stop your test session first.

## Docs

See [system architecture](../docs/02-system-architecture.md) and [feature specifications](../docs/04-feature-specifications.md).

## Manual backend connection test

1. Use backend code containing Srihith's development endpoint, from
   `feature/backend-dev-events` or a `main` version that includes it. Testing
   before merge is supported; see the separate-copy instructions below.
   A backend without the endpoint will return 404 even with the flag below.
   Start the backend **on the same computer as Chrome**, from that backend's
   directory, with its Python environment active:

   ```sh
   VOUCH_ENABLE_DEV_ENDPOINTS=true uvicorn app.main:app --reload
   ```

   The log should say `Development endpoints are ENABLED (/api/dev/*)`.
   Use `http://127.0.0.1:8000`, not `localhost` or Srihith's computer.
2. Stop any local recording session. Open `chrome://extensions`, find Vouch,
   click **Reload**, then close and reopen its popup.
3. Click **Send Test Event**. No recording consent or Start action is required.
   The button sends exactly one synthetic event with `session_id: "test-session-001"`,
   `event_type: "EXTENSION_CONNECTED"`, a fresh UTC ISO timestamp, and empty metadata.
   It never sends local records and does not retry automatically.
4. Expand **Inspect test response** for the HTTP status and raw response body.
   Acceptance shows **Test event sent successfully!** with HTTP 201 and an
   `event_id` in the response. Copy that ID and open
   `http://127.0.0.1:8000/api/dev/events` in a browser; find the same `event_id`
   and `session_id: "test-session-001"` in the returned `events` array to check
   what the backend received. Events are kept in memory, oldest first, and
   cleared on backend restart.
5. For more detail, right-click inside the popup and choose **Inspect**; use **Network** to view
   the POST payload/response and **Console** for browser errors. Keep the popup
   open while testing; closing it can interrupt the request.

### Test Srihith's branch before it is merged

From the project root, these commands fetch the branch and extract its backend
into a temporary directory. They preserve your current branch and extension
edits. Leave the final command running while testing in Chrome:

```sh
git fetch origin feature/backend-dev-events
backend_test_dir=$(mktemp -d /tmp/vouch-backend-test.XXXXXX)
git archive origin/feature/backend-dev-events backend | tar -x -C "$backend_test_dir"
python3 -m venv "$backend_test_dir/.venv"
"$backend_test_dir/.venv/bin/python" -m pip install -r "$backend_test_dir/backend/requirements.txt"
VOUCH_ENABLE_DEV_ENDPOINTS=true "$backend_test_dir/.venv/bin/python" -m uvicorn app.main:app --app-dir "$backend_test_dir/backend" --host 127.0.0.1 --port 8000
```

Only run one backend on port 8000 at a time. Press **Ctrl+C** in its terminal to
stop it. To restart, run the last command in the same terminal while the
temporary directory still exists. A backend restart clears its in-memory events.

### Confirmed development contract

`POST /api/dev/events` accepts only these four fields: `session_id` (a string
of 1–128 characters), `event_type` (`EXTENSION_CONNECTED`), `timestamp` (UTC
ISO 8601 ending in `Z`), and `metadata` (a JSON object up to 4 KB). The original
test session ID and empty metadata meet these rules; no real interview session
is needed. No authentication token is sent; this development endpoint restricts
requests to the same machine.

`backend-config.js` confirms acceptance only when the status is **201**, JSON
has `success: true`, `event_id` is a nonempty string, and `session_id` matches
the submitted test event. Example:

```json
{
  "success": true,
  "event_id": "evt_35fe4eeace2b49768f656aef4eb549fa",
  "session_id": "test-session-001",
  "message": "Development test event stored."
}
```

The display message is not used to decide acceptance. A different success
status, missing event ID, mismatched session, or invalid JSON is treated as an
unexpected response. Backend errors use `error.message`; validation errors
also include `error.details` entries with the field `location` and `message`.
This contract comes from Srihith's Milestone 3 backend-to-extension handoff.

### Configuration and troubleshooting

Edit `baseUrl` in `backend-config.js` to change the local port and update the
port in `manifest.json`'s `host_permissions` to match, then reload the extension.
The host permission is only `http://127.0.0.1:8000/*`; configuration is limited
to HTTP on that loopback host. See [Chrome match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns).
No additional monitoring permissions were added.

- Connection failure: verify the backend is running, the configured port is
  correct, and `http://127.0.0.1:8000/health` responds. Health alone does not
  prove the event endpoint is implemented.
- 404: confirm Srihith's endpoint code is in your local checkout and restart
  with `VOUCH_ENABLE_DEV_ENDPOINTS=true`. The default is disabled.
- 403: the endpoint rejects nonlocal requests. Run backend and Chrome on the
  same computer and connect directly to `127.0.0.1`.
- 422: the popup shows the validation message and field details; compare the
  payload with the confirmed schema above.
- 500: inspect backend logs; the extension cannot fix server errors.
- Timeout: the popup stops waiting after 10 seconds. The server may have
  received the event, so inspect its logs before sending another.
- Browser policy/CORS error: inspect the actual Console/Network message and
  verify the extension was reloaded with the matching host permission. Srihith
  confirmed that this permission allows the MV3 request without a per-extension
  backend origin setting. Keep the frontend CORS configuration unchanged.

The pre-existing consent-based local recording is preserved and independent of
this button. No automatic backend transmission or new monitoring was added.
