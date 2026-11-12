// Local development configuration. Reload the extension after editing.
const VOUCH_BACKEND = Object.freeze({
  baseUrl: "http://127.0.0.1:8000",
  timeoutMs: 10000,
  // Srihith's Milestone 3 development endpoint contract.
  confirmsAcceptance(status, body, sessionId) {
    return status === 201 &&
      body?.success === true &&
      typeof body.event_id === "string" && body.event_id.trim().length > 0 &&
      body.session_id === sessionId;
  },
});
