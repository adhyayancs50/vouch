// Serialize updates so closely spaced events cannot overwrite one another.
let pending = Promise.resolve();
function enqueue(task) {
  const result = pending.then(task);
  pending = result.catch(console.error);
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !["START", "STOP"].includes(message.type)) return;
  enqueue(async () => {
    const { session } = await chrome.storage.local.get("session");
    if (message.type === "START") {
      if (message.consent !== true) throw new Error("Consent is required.");
      if (session?.active) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.storage.local.set({
        session: {
          id: crypto.randomUUID(), active: true,
          startedAt: new Date().toISOString(), consentVersion: "local-test-1",
          previousTabId: tab?.id ?? null
        },
        events: []
      });
    } else if (session?.active) {
      await chrome.storage.local.set({
        session: { ...session, active: false, endedAt: new Date().toISOString() }
      });
    }
  }).then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  const timestamp = new Date().toISOString();
  enqueue(async () => {
    const { session, events = [] } = await chrome.storage.local.get(["session", "events"]);
    if (!session?.active) return;
    events.push({
      event_id: crypto.randomUUID(), session_id: session.id,
      event_type: "TAB_SWITCH", timestamp,
      metadata: { active_tab_id: tabId, previous_tab_id: session.previousTabId, window_id: windowId }
    });
    const limitReached = events.length >= 1000;
    await chrome.storage.local.set({
      events,
      session: {
        ...session, previousTabId: tabId,
        ...(limitReached ? { active: false, endedAt: timestamp, stopReason: "Record limit reached" } : {})
      }
    });
  });
});

// A browser restart requires fresh consent rather than silently resuming.
chrome.runtime.onStartup.addListener(() => enqueue(async () => {
  const { session } = await chrome.storage.local.get("session");
  if (session?.active) await chrome.storage.local.set({
    session: { ...session, active: false, stopReason: "Browser restarted" }
  });
}));
