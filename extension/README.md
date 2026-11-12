# extension

Browser extension for vouch, the privacy-first interview verification system.

## Status

Local Manifest V3 prototype with explicit consent, Start/Stop controls, and tab-switch recording. A manual backend connection test uses Srihith's confirmed Milestone 3 development API contract. No build step or dependencies required.

## Try it

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**, click **Load unpacked**, and select this `extension/` folder.
3. Open Vouch from Chrome's extensions menu.
4. Accept the recording notice and click **Start test session**.
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
