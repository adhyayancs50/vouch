// Only session identifiers, the reviewed consent version and sanitized worker views cross this boundary.
const monitoringPanel = (() => {
  const byId = id => document.getElementById(id);
  const buttons = {
    grant: byId("grant-consent"),
    decline: byId("decline-consent"),
    start: byId("start-monitoring"),
    stop: byId("stop-monitoring"),
    withdraw: byId("withdraw-consent"),
    state: byId("refresh-monitoring"),
    clear: byId("clear-joined-interview"),
  };
  let interview;
  let view;
  let requestId = 0;
  let actionInFlight;
  let reopened = false;
  let notice = "";
  let previousReview;

  function button(action, visible, enabled) {
    buttons[action].hidden = !visible;
    buttons[action].disabled = !visible || !enabled;
  }

  function render() {
    const state = view?.state;
    const consent = state?.consent.status;
    const monitoring = state?.monitoring.status;
    const ending = actionInFlight === "stop" || actionInFlight === "withdraw";
    const pending = view?.pending;
    const usable = !view?.needsCode && !pending;
    const currentGrant = consent === "GRANTED" && state.consent.consent_version === state.consent.required_version;
    const available = usable && !actionInFlight;
    const reviewing = state && !currentGrant && monitoring !== "STOPPED" && usable;
    const unknown = !state && reopened && !view?.needsCode;
    const canWithdraw = consent === "GRANTED" || unknown || actionInFlight === "grant";
    const starting = actionInFlight === "start";

    byId("consent-status").textContent = consent || "Unconfirmed";
    byId("monitoring-status").textContent = monitoring || "Unconfirmed";
    byId("collection-status").textContent = typeof view?.collecting === "boolean"
      ? (view.collecting ? "Running" : "Off") : "Checking…";
    byId("collection-status").dataset.running = String(view?.collecting === true);
    byId("consent-version").textContent = state?.consent.required_version || "";
    byId("consent-version-row").hidden = !state;
    if (state && previousReview !== Boolean(reviewing)) {
      byId("policy-disclosure").open = Boolean(reviewing);
      previousReview = Boolean(reviewing);
    }

    let text = notice || view?.message || "";
    if (pending && !text) text = "Local collection is off. Waiting for backend confirmation.";
    else if (!pending && ending) text = actionInFlight === "stop" ? "Requesting a stop…" : "Requesting consent withdrawal…";
    else if (!view && !text) text = "Checking interview status…";
    byId("monitoring-message").textContent = text;
    byId("monitoring-message").hidden = !text;

    button("grant", reviewing, available);
    button("decline", reviewing && consent === "NONE", available);
    button("start", currentGrant && monitoring === "NOT_STARTED", available);
    button("stop", !view?.needsCode && (monitoring === "ACTIVE" || starting || unknown),
      !ending && !pending);
    button("withdraw", !view?.needsCode && canWithdraw, actionInFlight !== "withdraw" && pending !== "withdraw");
    button("state", !!interview, !actionInFlight);
    button("clear", !!view?.canClear, !actionInFlight);
    byId("clear-interview-row").hidden = buttons.clear.hidden;
  }

  function applyView(next) {
    if (!next || typeof next.collecting !== "boolean" ||
        (next.state && next.state.session_id !== interview.sessionId)) return false;
    // A stopped session is terminal, including if an older popup message arrives late.
    if (view?.state?.monitoring.status === "STOPPED" && next.state &&
        next.state.monitoring.status !== "STOPPED") return true;
    view = next;
    if (next.state) interview.renderDetails(next.state);
    return true;
  }

  async function command(action) {
    if (!interview || (action !== "state" && buttons[action].disabled)) return;
    const id = ++requestId;
    const message = { action, sessionId: interview.sessionId };
    if (action === "grant") message.consentVersion = byId("consent-version").textContent;
    actionInFlight = action;
    notice = "";
    render();
    try {
      const next = await chrome.runtime.sendMessage(message);
      if (id !== requestId) return;
      if (action === "clear" && next?.cleared) {
        const cleared = interview.onCleared;
        interview = null;
        view = null;
        cleared();
      } else if (!applyView(next)) {
        throw new Error("Worker state unavailable");
      }
    } catch {
      if (id !== requestId) return;
      // Losing the message port says nothing about whether the action reached the worker.
      notice = action === "clear" ? "Could not clear the saved interview details. Refresh status and try again."
        : "The extension could not confirm the current status. Refresh status or reopen the popup.";
    } finally {
      if (id === requestId) {
        actionInFlight = null;
        render();
      }
    }
  }

  for (const [action, control] of Object.entries(buttons)) {
    control.addEventListener("click", () => command(action));
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.action !== "monitoringUpdate" ||
        !interview || message.sessionId !== interview.sessionId) return;
    // During an interruption, a previously scheduled update can still describe active collection.
    if ((actionInFlight === "stop" || actionInFlight === "withdraw") && message.view?.collecting) return;
    if (applyView(message.view)) {
      notice = "";
      render();
    }
  });

  return {
    open(sessionId, renderDetails, onCleared, isReopened) {
      interview = { sessionId, renderDetails, onCleared };
      view = null;
      notice = "";
      previousReview = undefined;
      reopened = isReopened;
      return command("state");
    },
  };
})();
