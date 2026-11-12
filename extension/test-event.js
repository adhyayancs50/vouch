const sendTestEvent = document.getElementById("send-test-event");
const testEventStatus = document.getElementById("test-event-status");
const testEventResponse = document.getElementById("test-event-response");

sendTestEvent.addEventListener("click", async () => {
  if (sendTestEvent.disabled) return;
  sendTestEvent.disabled = true;
  sendTestEvent.textContent = "Sending…";
  testEventStatus.textContent = "Sending test event…";
  testEventResponse.textContent = "Waiting for response…";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOUCH_BACKEND.timeoutMs);
  try {
    const base = new URL(VOUCH_BACKEND.baseUrl);
    // Keep configuration aligned with the narrowly scoped host permission.
    if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" ||
        base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
      throw new Error("Configure an HTTP base URL on 127.0.0.1 (for example http://127.0.0.1:8000).");
    }
    const event = {
      session_id: "test-session-001",
      event_type: "EXTENSION_CONNECTED",
      timestamp: new Date().toISOString(),
      metadata: {},
    };
    const response = await fetch(new URL("/api/dev/events", base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
      body: JSON.stringify(event),
    });
    const raw = await response.text();
    testEventResponse.textContent = `HTTP ${response.status} ${response.statusText}\n${raw || "(empty body)"}`;
    let body;
    try { body = JSON.parse(raw); } catch { /* Display raw response for diagnosis. */ }
    if (!response.ok) {
      const detail = body?.error?.message || (typeof body?.detail === "string" ? body.detail : null);
      const validation = Array.isArray(body?.error?.details)
        ? body.error.details.map(item => `${item.location}: ${item.message}`).join("; ")
        : "";
      const hint = response.status === 404
        ? "Confirm the dev endpoint code is present and start the backend with VOUCH_ENABLE_DEV_ENDPOINTS=true."
        : response.status === 403
          ? "The dev endpoint only accepts requests from the same machine. Run the backend locally and connect directly to 127.0.0.1."
          : "See the response below.";
      throw new Error(`Backend rejected the test event (HTTP ${response.status}). ${[detail, validation, hint].filter(Boolean).join(" ")}`);
    }
    if (VOUCH_BACKEND.confirmsAcceptance(response.status, body, event.session_id)) {
      testEventStatus.textContent = "Test event sent successfully!";
    } else {
      throw new Error("Backend response did not confirm acceptance under the agreed API contract. See the response below.");
    }
  } catch (error) {
    testEventStatus.textContent = error.name === "AbortError"
      ? `Request timed out after ${VOUCH_BACKEND.timeoutMs / 1000} seconds. Check that the backend is running; it may still have received the event.`
      : error instanceof TypeError
        ? `Cannot reach ${VOUCH_BACKEND.baseUrl}. Check the backend, port, and extension host permission. See Console/Network for details.`
        : error.message;
    if (testEventResponse.textContent === "Waiting for response…") {
      testEventResponse.textContent = "No response available. Inspect the popup Console and Network panel.";
    }
  } finally {
    clearTimeout(timeout);
    sendTestEvent.disabled = false;
    sendTestEvent.textContent = "Send Test Event";
  }
});
