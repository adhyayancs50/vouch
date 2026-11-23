// The worker starts this collector only after confirming the candidate is ACTIVE.
function createActivityCollector(chrome, onEvent) {
  let running = false;
  let focus = null;
  let selection = null;

  function hostname(url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
      // Match the event API's DNS-label/IPv4 contract, including punycode names.
      const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
      return host.length <= 253 && host.split(".").every(part => label.test(part)) ? host : null;
    } catch {
      return null;
    }
  }

  function record(event_type, tab_id, hostname) {
    onEvent({ event_type, tab_id, hostname, occurred_at: new Date().toISOString() });
  }

  // Seed from the current selection without manufacturing a navigation. A newer
  // focus/activation/update or Stop always wins over a delayed Chrome lookup.
  function seed(tab, target) {
    if (selection !== target || target.hostname !== undefined || !tab?.active ||
        tab.incognito || tab.windowId !== focus?.windowId || !Number.isInteger(tab.id)) return;
    target.tabId = tab.id;
    target.hostname = hostname(tab.url);
  }

  async function setFocus(windowId) {
    const scope = {};
    focus = scope;
    selection = null;
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    try {
      const win = windowId === undefined ? await chrome.windows.getLastFocused() : await chrome.windows.get(windowId);
      if (focus !== scope || !win.focused || win.incognito || !["normal", "popup"].includes(win.type)) return;
      scope.windowId = win.id;
      const target = {};
      selection = target;
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
      seed(tab, target);
    } catch {
      // The window or tab may have closed during the lookup.
    }
  }

  function activated({ tabId, windowId }) {
    if (!running || windowId !== focus?.windowId || tabId < 0) return;
    const target = { tabId };
    selection = target;
    // Chrome supplies no URL with activation. Emit immediately to preserve
    // switch order rather than attributing a later navigation to this switch.
    record("TAB_SWITCH", tabId, null);
    chrome.tabs.get(tabId).then(tab => seed(tab, target)).catch(() => {});
  }

  function updated(tabId, change, tab) {
    if (!running || !tab.active || tab.incognito || tab.windowId !== focus?.windowId ||
        tabId < 0 || typeof change.url !== "string" || !selection) return;
    if (selection.tabId !== undefined && selection.tabId !== tabId) return;
    const next = hostname(change.url);
    const previous = selection.hostname;
    selection.tabId = tabId;
    selection.hostname = next;
    if (previous !== undefined && next !== null && next !== previous) {
      record("WEBSITE_NAVIGATION", tabId, next);
    }
  }

  function focusChanged(windowId) {
    if (running) void setFocus(windowId);
  }

  return {
    start() {
      if (running) return;
      running = true;
      chrome.windows.onFocusChanged.addListener(focusChanged);
      chrome.tabs.onActivated.addListener(activated);
      chrome.tabs.onUpdated.addListener(updated);
      void setFocus();
    },
    stop() {
      if (!running) return;
      running = false;
      focus = null;
      selection = null;
      chrome.windows.onFocusChanged.removeListener(focusChanged);
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
    },
  };
}
