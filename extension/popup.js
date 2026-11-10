const consent = document.getElementById("consent");
const start = document.getElementById("start");
const stop = document.getElementById("stop");
const status = document.getElementById("status");
let active = false;
let busy = true;

function updateButtons() {
  consent.disabled = busy || active;
  start.disabled = busy || active || !consent.checked;
  stop.disabled = busy || !active;
}

async function render() {
  const { session, events = [] } = await chrome.storage.local.get(["session", "events"]);
  active = Boolean(session?.active);
  status.textContent = active ? "Recording tab switches" : session?.stopReason || "Not recording";
  document.getElementById("count").textContent = `Recorded switches: ${events.length}`;
  document.getElementById("events").textContent = JSON.stringify(events, null, 2);
  updateButtons();
}

async function command(type) {
  busy = true;
  updateButtons();
  try {
    const result = await chrome.runtime.sendMessage({ type, consent: consent.checked });
    if (!result?.ok) throw new Error(result?.error || "Unable to update session.");
    if (type === "STOP") consent.checked = false;
    await render();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
    updateButtons();
  }
}

consent.addEventListener("change", updateButtons);
start.addEventListener("click", () => command("START"));
stop.addEventListener("click", () => command("STOP"));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") render().catch(error => { status.textContent = error.message; });
});
render().catch(error => { status.textContent = error.message; }).finally(() => {
  busy = false;
  updateButtons();
});
