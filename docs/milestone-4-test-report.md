# Milestone 4 QA test report

**Date:** November 19, 2026  
**Branch:** `testing/milestone-4`  
**Tester:** Javier Ascanio  
**Environment:** Local macOS, Chrome, FastAPI backend and React/TypeScript frontend.

## 1. Scope

Independent QA of the existing interview creation and candidate join workflow, employer dashboard, Chrome extension, and Milestone 3 regression paths. The session contract is documented in `backend/API_SESSIONS.md`. Results below distinguish automated tests from manual browser checks. No application code or automated test files were changed in this pass.

## 2. Automated test results

| Component | Command (working directory) | Passed | Failed | Runtime |
| --- | --- | ---: | ---: | ---: |
| Backend | `pytest -q` (`backend/`) | 258 | 0 | 6.64 s |
| Frontend | `npm test` (`frontend/`) | 16 | 0 | 0.80 s |
| Chrome extension | `node --test extension/tests/join-session.test.mjs` (repository root) | 24 | 0 | 0.075 s |
| **Total** | | **298** | **0** | |

The frontend production build (`npm run build` from `frontend/`) also completed successfully, including TypeScript checking and Vite bundling. Vite reported a build time of 273 ms.

One backend test warning was observed: Starlette's httpx-based TestClient integration is deprecated and recommends httpx2. This did not cause a failure. Dependency changes are outside this report's scope.

## 3. Manual end-to-end and negative tests

The backend ran locally with `VOUCH_ENABLE_DEV_ENDPOINTS=true` on port 8000; the frontend ran on port 5173. The unpacked Chrome extension was reloaded. Two fictional sessions were created: `Milestone 4 - QA Test 01` and `Milestone 4 - Privacy Test`.

| Check | Observed result | Status |
| --- | --- | --- |
| Initial employer dashboard | Empty session list and creation control displayed | PASS |
| Create interview | Interview appeared in list with CREATED status | PASS |
| Generate join code | Code displayed with copy and dismissal controls; expiration was 72 hours after creation | PASS |
| Valid candidate join | Extension displayed Joined confirmation | PASS |
| Candidate and policy synchronization | Title, candidate name, policy and allowed/restricted domains matched | PASS |
| Employer status refresh | Session changed to JOINED | PASS |
| Saved join confirmation | Extension displayed saved confirmation on reopening | PASS |
| Reuse consumed code | Error indicated code had already been used | PASS |
| Invalid code | Error indicated invalid join code | PASS |
| Blank code | Extension prompted for the interview join code | PASS |
| Session details | Both sessions displayed correct policy, candidate names, distinct candidate IDs and timestamps | PASS |
| Join-code confidentiality in details | Neither detail view exposed the join code | PASS |

The full-page reload and join-code dismissal were requested during testing, but the screenshots directly establish only that both session detail views remained accessible and did not expose codes. No raw join codes or candidate identifiers are included in this report.

## 4. Regression testing

| Check | Observed result | Status |
| --- | --- | --- |
| Dashboard Test Backend Connection | Successful connection message | PASS |
| Extension Send Test Event | Successful event message | PASS |
| GET `/api/dev/events` | One `EXTENSION_CONNECTED` event received with empty metadata | PASS |

These checks confirm the existing local development integration still works alongside the session join workflow.

## 5. Privacy and consent checks

| Check | Observed result | Status |
| --- | --- | --- |
| Consent checkbox | Unchecked | PASS |
| Recording state after joining | Not recording | PASS |
| Start test session without consent | Disabled | PASS |
| Tab switching without consent | Existing local record count remained at five after additional switches (tester-reported) | PASS |
| Development event endpoint | No additional events reported after tab switching | PASS |

The five existing records were used as a baseline; their original source was not verified. These observations support the intended separation of interview joining from the local recording prototype. They do not establish that all network traffic is free of tracking data; no comprehensive network capture or security audit was performed.

## 6. Coverage and limitations

Existing automated suites include backend health, CORS, errors, development events, sessions and monitoring; frontend session/API tests; and extension join tests. The frontend and extension test runs cover validation, errors, network failure and other edge cases. No new automated tests were authored in this QA pass.

Recommended follow-up: add browser-level automated coverage of the actual employer UI and full candidate join flow, including code dismissal/reload and policy rendering. Expiration and concurrent joins were not manually reproduced. Real employer authentication, production deployment, activity timeline UI and a comprehensive monitoring/consent lifecycle were not manually verified. The session API is explicitly development-only; its employer header is not secure authentication. A passing result is not production security clearance.

## 7. Conclusion

All 298 existing automated tests passed, the production frontend build succeeded, and no defects were observed in the executed manual scenarios. One non-blocking test dependency warning remains. The tested local interview creation/join workflow and legacy regression paths are suitable for milestone review, subject to the scope limitations above.
