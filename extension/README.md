# Vouch Chrome extension

A candidate joins an interview, reviews the employer’s AI-use policy and decides whether to share browser activity. Granting consent and starting monitoring are separate actions. The employer can review the timestamped events that the backend accepts.

## Run locally

1. Use Chrome 111 or later and the Milestone 5 backend on the same computer. From the repository root, start the development server.

   ```sh
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   python3 -m pip install -r requirements.txt
   VOUCH_ENABLE_DEV_ENDPOINTS=true python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

   If you have a Milestone 4 database, point `VOUCH_DATABASE_URL` at a fresh SQLite database, for example `sqlite:////tmp/vouch-monitoring-test.db`. The backend has no migration for the old schema. The candidate APIs require the development flag and a loopback connection. [Session contract](../backend/API_SESSIONS.md) · [Monitoring contract](../backend/API_MONITORING.md)

2. Create an interview in the employer dashboard. For a local test you can also run the following command. Keep the returned `session_id` and copy the one-time `candidate_join_code`.

   ```sh
   curl --noproxy '*' -sS http://127.0.0.1:8000/api/sessions \
     -H 'Content-Type: application/json' \
     -H 'X-Vouch-Dev-Employer: extension-test' \
     -d '{"title":"Extension monitoring test","policy":{"ai_usage":"PARTIALLY_ALLOWED","allowed_domains":["docs.python.org"],"restricted_domains":[]}}'
   ```

3. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select this `extension/` directory. Click **Reload** if it is already installed. No extension build or package install is required.
4. Open Vouch, enter the code and optionally your name. Keep the popup open until joining is confirmed. A lost response can consume the code. Ask the employer to verify before trying it again.
5. Review the title, domain lists, AI-use policy and disclosure. **Decline Consent** leaves collection off. **Grant Consent** records the displayed disclosure version. **Start Monitoring** begins collection once the server confirms `ACTIVE`.
6. The popup shows separate consent, monitoring and local collection states. Close the popup to browse. **Stop Monitoring** ends this session’s collection. **Withdraw Consent** records withdrawal and ends active monitoring. You can also withdraw after stopping. A stopped session requires a fresh interview to monitor again.

The collapsed **Development connection test** sends one synthetic `EXTENSION_CONNECTED` record to `/api/dev/events` when clicked. The former local recording prototype has been replaced by the authenticated interview controls. Its older local records are never uploaded.

## Permissions and data

| Permission | Purpose |
| --- | --- |
| `storage` | Save the joined interview and bearer credential, last confirmed candidate state, pending stop or withdrawal, and the bounded event queue and sequence. Local storage access is restricted to trusted extension contexts. |
| `tabs` | Read tab URL changes and the selected tab’s hostname in the focused Chrome window. Only a validated hostname can enter a website-navigation event. |
| `alarms` | Wake the service worker to verify active state, retry eligible uploads and finish pending stops or withdrawals while the popup is closed. |
| `http://127.0.0.1:8000/*` | Send interview requests to the local development backend. If you change its port, update `backend-config.js` and the manifest together. |

The extension has no content scripts, page injection or browsing-history permission. It excludes incognito windows. Only the trusted popup and service worker handle the candidate credential. Candidate API requests send it in the bearer header and refuse redirects. A missing, invalid or expired credential requires a new session and code from the employer. This also applies to interviews joined with the Milestone 4 extension.

While collection is running, a tab switch records the selected tab ID and a UTC timestamp. The switch hostname may be null. A website-navigation event records a change in the selected tab’s HTTP(S) hostname. Same-host paths, queries, fragments, reloads and background-tab navigations produce no navigation event. URLs, page contents or titles, screenshots, keystrokes and clipboard contents are never saved in the activity queue or sent. Activity in another browser, device or application is outside the extension’s scope. The records describe observations and do not establish whether someone used AI.

## Delivery and recovery

- The service worker checks `GET /api/sessions/{id}/candidate` on popup refresh and before resuming a locally started session after a worker restart. Collection requires current consent, a usable credential and confirmed `ACTIVE` state. A pending stop or withdrawal takes precedence, including when the server still reports `ACTIVE`.
- Each event gets a UUID and a per-session sequence number. The worker saves the exact payload and next sequence together before uploading. It sends at most 50 per request and accepts both `STORED` and `DUPLICATE` acknowledgments for those IDs.
- Transient failures use bounded exponential backoff and respect `Retry-After`. The queue holds at most 250 events. Collection pauses at capacity and can resume when space is available and the session still qualifies. A permanently rejected event is isolated, counted and discarded. Reaching the server’s session limit pauses collection.
- Stop immediately detaches activity listeners. The worker serializes any in-flight upload, tries to flush eligible queued events, then requests the stop. Withdrawal skips the final flush. If the server cannot confirm termination, the popup shows collection off and confirmation pending. The worker retries the termination without resending events. Once termination is confirmed, any remaining undeliverable events are discarded and counted.
- Chrome can suspend the worker. Events that occur while it is waking, rechecking the session or establishing a new focused-tab baseline can be missed. There is no history backfill. Window focus changes establish a new baseline and alone produce no event. Internal URLs, IPv6 literals and hostnames the backend cannot accept produce no website-navigation event. [Chrome service-worker events](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events)

## Tests

From the repository root, use Node.js 22 or later.

```sh
node --test extension/tests/*.test.mjs
```

The tests exercise popup joining and consent, Chrome tab and window callbacks, and service-worker behavior with controlled storage, network failures and restarts. Use real Chrome and the local backend for the following checks.

1. Join a fresh interview and compare the title and policy with the employer’s setup. Switch tabs, decline, then grant consent. Before Start, verify the employer’s timeline is empty.
2. Choose **Start Monitoring**, close the popup and switch between two tabs in the focused window. In one active tab, navigate from `http://localhost:8000/health` to `http://127.0.0.1:8000/health?private=example#fragment`. Change only the path or query on the second host. Check that tab switches and the hostname change appear in sequence and the path, query and fragment never appear.
3. To inspect the employer timeline, substitute the session ID and use the employer key that created the interview.

   ```sh
   curl --noproxy '*' -sS \
     -H 'X-Vouch-Dev-Employer: extension-test' \
     'http://127.0.0.1:8000/api/sessions/SESSION_ID/events'
   ```

4. Reopen the popup, choose **Stop Monitoring** and verify `STOPPED` and local collection **Off**. Switch tabs and check that the timeline no longer grows. Reopen again and verify that Start is unavailable. In a second interview, withdraw consent while active and verify both `WITHDRAWN` and `STOPPED`.
5. In a fresh active interview, stop the backend, choose **Stop Monitoring** and close the popup. Restart the backend with the same database. Reopen the popup or wait for the retry alarm, then verify `STOPPED` and that activity during the outage was excluded. Repeat for withdrawal.
6. Close extension DevTools and let Chrome suspend the worker. Reopen the popup while active and after stopping. Verify that a backend check precedes resumed collection and that a stopped session stays off. Worker scheduling and browser sleep can delay alarms, so elapsed wall-clock time and uninterrupted coverage cannot be guaranteed.
