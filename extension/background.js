importScripts("backend-config.js", "candidate-api.js", "activity.js");

const local = chrome.storage.local;
const ALARM = "vouch-monitoring";
const MAX_QUEUE = 250;
const BATCH_LIMIT = 50;
const NEW_CODE = "Ask your employer for a new interview session and code.";
const collector = createActivityCollector(chrome, recordActivity);

let credential = null;
let session = null;
let verified = false;
let collecting = false;
let message = "";
let endWarning = "";
let writesWaiting = 0;
let uploadTimer;
let expiryTimer;
let work = Promise.resolve();
let upkeep;
const endRequests = new Map();
let endingCommands = 0;

// Serialize API requests and queue writes. Stop/withdraw also install a durable
// veto outside this lane so they take effect during an in-flight request.
function enqueue(task) {
  const result = work.then(task);
  work = result.catch(() => {
    pauseCollection();
    verified = false;
    message = "Vouch could not save or check the interview. Reopen the popup to try again.";
    publish();
  });
  return result;
}

function endKey(id) { return `monitoringEnd:${id}`; }
function withdrawKey(id) { return `monitoringWithdraw:${id}`; }
function pendingEnd() { return endRequests.get(session?.sessionId) || null; }
function save() { return local.set({ monitoringSession: session }); }

function wake() {
  if (!upkeep) {
    upkeep = enqueue(maintenance);
    upkeep.then(() => { upkeep = null; }, () => { upkeep = null; });
  }
  return upkeep;
}

function pauseCollection() {
  collector.stop();
  collecting = false;
  clearTimeout(uploadTimer);
  uploadTimer = undefined;
  clearTimeout(expiryTimer);
}

function hasConsent(state) {
  return state?.consent.status === "GRANTED" &&
    state.consent.consent_version === state.consent.required_version;
}

function shouldCollect() {
  return verified && session?.armed && !pendingEnd() && credential &&
    Date.parse(credential.candidate_token_expires_at) > Date.now() &&
    hasConsent(session.state) && session.state.monitoring.status === "ACTIVE" &&
    !session.limitReached && session.queue.length < MAX_QUEUE;
}

function updateCollection() {
  if (!shouldCollect()) {
    pauseCollection();
  } else if (!collecting) {
    collecting = true;
    collector.start();
    // Recheck even if the candidate leaves the popup closed and Chrome is idle.
    expiryTimer = setTimeout(() => {
      pauseCollection();
      wake();
    }, Math.max(0, Date.parse(credential.candidate_token_expires_at) - Date.now()));
  }
}

function view() {
  const pending = pendingEnd();
  const needsCode = Boolean(session && !credential);
  let detail = message;
  if (pending && needsCode) detail = "Collection is off. The backend could not confirm your request. " + NEW_CODE;
  else if (needsCode) detail = "This interview has no usable candidate credential. " + NEW_CODE;
  else if (pending) detail = "Collection is off. Waiting for the backend to confirm " +
    (pending === "withdraw" ? "withdrawal of consent." : "the stop request.") + endWarning;
  else if (session?.limitReached) detail = "The backend event limit was reached. Collection is off. You can stop monitoring.";
  else if (session?.queue.length >= MAX_QUEUE) detail = "The event queue is full. Collection is paused until uploads succeed.";
  if (session?.lost) detail += ` ${session.lost} queued event(s) could not be delivered.`;
  return {
    state: session?.state || null, pending, collecting, needsCode, message: detail.trim(),
    canClear: needsCode || Boolean(session && !pending && !session.armed &&
      ["NOT_STARTED", "STOPPED"].includes(session.state?.monitoring.status)),
  };
}

function publish() {
  if (session) chrome.runtime.sendMessage({
    action: "monitoringUpdate", sessionId: session.sessionId, view: view(),
  }).catch(() => {}); // Usually there is no open popup.
}

async function ensureAlarm() {
  if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}

async function updateAlarm() {
  if (credential && (session?.armed || pendingEnd())) await ensureAlarm();
  else await chrome.alarms.clear(ALARM);
}

async function loadSession(expectedId) {
  if (session && (!expectedId || session.sessionId === expectedId)) return true;
  await local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const { joinedInterview: joined, candidateCredential: saved, monitoringSession: stored } =
    await local.get(["joinedInterview", "candidateCredential", "monitoringSession"]);
  if (!joined?.session_id || (expectedId && expectedId !== joined.session_id)) return false;
  pauseCollection();
  verified = false;
  const stop = endKey(joined.session_id);
  const withdraw = withdrawKey(joined.session_id);
  // Do not cache the credential/session until the persisted stop fences have
  // also been read. A temporary storage failure must leave recovery gated.
  const intents = await local.get([stop, withdraw]);
  message = "";
  endWarning = "";
  session = stored?.sessionId === joined.session_id && stored.candidateId === joined.candidate_id
    ? stored : { sessionId: joined.session_id, candidateId: joined.candidate_id, state: null,
      armed: false, queue: [], nextSequence: 0, retryAt: 0, failures: 0, lost: 0 };
  credential = saved?.session_id === joined.session_id && saved.candidate_id === joined.candidate_id &&
    saved.token_type === "Bearer" && typeof saved.candidate_token === "string" &&
    saved.candidate_token.trim() && Date.parse(saved.candidate_token_expires_at) > Date.now() ? saved : null;
  // A cold worker can receive Stop before reading an older withdrawal. The
  // two intents have independent keys so Stop cannot overwrite withdrawal.
  if (intents[withdraw] === "withdraw" || session.endIntent === "withdraw") endRequests.set(session.sessionId, "withdraw");
  else if (!pendingEnd() && (intents[stop] === "stop" || session.endIntent === "stop")) endRequests.set(session.sessionId, "stop");
  if (!credential) await loseCredential();
  return true;
}

async function loseCredential() {
  pauseCollection();
  verified = false;
  credential = null;
  session.armed = false;
  session.lost += session.queue.length;
  session.queue = [];
  await local.set({ candidateCredential: null, monitoringSession: session });
  await chrome.alarms.clear(ALARM);
  publish();
}

async function acceptState(data) {
  const state = readCandidateState(data, credential);
  session.state = state;
  verified = true;
  if (state.monitoring.status === "STOPPED" || state.consent.status === "WITHDRAWN" ||
      state.monitoring.status === "NOT_STARTED") {
    session.armed = false;
    session.lost += session.queue.length;
    session.queue = [];
  }
  await save();
  updateCollection();
  await updateAlarm();
  publish();
}

function authFailure(error) { return error.status === 401 || error.status === 403; }

async function refresh() {
  try {
    const state = await candidateRequest(credential, "candidate");
    message = "";
    await acceptState(state);
    return true;
  } catch (error) {
    verified = false;
    pauseCollection();
    if (authFailure(error) || error.code === "SESSION_NOT_FOUND") await loseCredential();
    else message = "Could not verify the current interview state. Collection is paused. Check the local backend and try again.";
    publish();
    return false;
  }
}

function scheduleUpload() {
  if (uploadTimer || !verified || !session.queue.length || pendingEnd() || session.retryAt > Date.now()) return;
  uploadTimer = setTimeout(() => {
    uploadTimer = undefined;
    enqueue(async () => {
      if (!pendingEnd()) await flushQueue();
    });
  }, 750);
}

function recordActivity({ event_type, occurred_at, hostname, tab_id }) {
  if (!collecting || !shouldCollect()) return;
  // Count admissions waiting for disk as well as durable entries. This bounds
  // memory even during a slow network call or an unusually large burst.
  if (session.queue.length + writesWaiting >= MAX_QUEUE) {
    pauseCollection();
    publish();
    return;
  }
  const owner = session;
  writesWaiting++;
  enqueue(async () => {
    writesWaiting--;
    if (session !== owner || !credential || !session.armed ||
        session.state?.monitoring.status !== "ACTIVE" || pendingEnd() === "withdraw") return;
    const event = { client_event_id: crypto.randomUUID(), event_type, occurred_at,
      client_sequence: session.nextSequence++, hostname, tab_id };
    session.queue.push(event);
    await save(); // Sequence and immutable payload survive worker suspension together.
    if (session.queue.length >= MAX_QUEUE) {
      pauseCollection();
      publish();
    }
    scheduleUpload();
  });
}

function acknowledged(batch, data) {
  if (!Array.isArray(data?.results) || data.results.length !== batch.length) return false;
  const stored = data.results.filter(result => result?.status === "STORED").length;
  if (data.stored !== stored || data.duplicates !== batch.length - stored) return false;
  const ids = new Set(data.results.filter(r => r && typeof r.event_id === "string" && r.event_id.length > 0 &&
    ["DUPLICATE", "STORED"].includes(r.status)).map(r => r.client_event_id));
  return batch.every(event => ids.has(event.client_event_id));
}

async function flushQueue(beforeStop = false) {
  let size = BATCH_LIMIT;
  let requests = 0;
  while (credential && verified && session.armed && hasConsent(session.state) && session.state.monitoring.status === "ACTIVE" &&
         session.queue.length && !session.limitReached && Date.now() >= session.retryAt &&
         (!pendingEnd() || (beforeStop && pendingEnd() === "stop"))) {
    const batch = session.queue.slice(0, size);
    // A series of ambiguous per-item rejections can take many requests to
    // isolate. Yield to controls and the next alarm after a bounded attempt.
    if (++requests > 10) {
      session.retryAt = Date.now() + 15000;
      await save();
      return;
    }
    try {
      const result = await candidateRequest(credential, "events", "POST", { events: batch });
      if (!acknowledged(batch, result)) throw new CandidateRequestError(0, "INVALID_RESPONSE");
      session.queue.splice(0, batch.length);
      session.failures = 0;
      session.retryAt = 0;
      message = "";
      size = BATCH_LIMIT;
    } catch (error) {
      if (authFailure(error)) { await loseCredential(); return; }
      if (error.code === "MONITORING_NOT_ACTIVE") {
        verified = false;
        pauseCollection();
        await refresh();
        return;
      }
      if (error.code === "EVENT_LIMIT_REACHED") {
        session.limitReached = true;
      } else if (error.status === 422 || error.status === 413 || error.code === "EVENT_ID_CONFLICT") {
        // The server rejects the whole batch. Isolate a rejected item without
        // sacrificing its neighbors or assigning a new ID to the same event.
        const invalid = new Set(error.invalidEvents.filter(index => index < batch.length));
        if (!invalid.size && batch.length > 1) { size = Math.ceil(batch.length / 2); continue; }
        if (!invalid.size) invalid.add(0);
        session.queue = session.queue.filter((_, index) => !invalid.has(index));
        session.lost += invalid.size;
        size = BATCH_LIMIT;
      } else {
        session.failures++;
        const backoff = Math.min(300000, 15000 * 2 ** Math.min(session.failures - 1, 5));
        session.retryAt = Date.now() + Math.max(error.retryAfter || 0, backoff);
        message = "Event delivery is delayed. Vouch will retry when the backend is available.";
      }
    }
    await save();
    updateCollection();
    publish();
  }
}

async function finishEnd(flushFirst) {
  const id = session.sessionId;
  const action = pendingEnd();
  if (!action || !credential) return;
  try { await ensureAlarm(); } catch {
    endWarning = " Automatic retry is unavailable. Reopen the popup to retry.";
  }
  if (flushFirst && action === "stop") {
    // A storage error while saving an upload receipt must not prevent Stop.
    try { await flushQueue(true); } catch { verified = false; }
  }
  if (!credential || pendingEnd() !== action) return;
  try {
    const state = action === "stop"
      ? await candidateRequest(credential, "monitoring/stop", "POST")
      : await candidateRequest(credential, "consent", "POST", { decision: "WITHDRAWN" });
    await acceptState(state);
  } catch (error) {
    if (authFailure(error)) { await loseCredential(); return; }
    // A repeat after a lost response is safe. Also reconcile requests made
    // while the popup had no state (e.g. stopping before a start completed).
    if (error.status !== 409 || !await refresh()) { publish(); return; }
  }

  const state = session.state;
  const resolved = action === "stop" ? state.monitoring.status !== "ACTIVE"
    : (state.consent.status !== "GRANTED" && state.monitoring.status !== "ACTIVE");
  if (resolved && pendingEnd() === action) {
    session.armed = false;
    delete session.endIntent;
    await save();
    if (pendingEnd() !== action) return;
    await local.remove(action === "withdraw" ? [endKey(id), withdrawKey(id)] : endKey(id));
    if (pendingEnd() !== action) return;
    endRequests.delete(id);
    endWarning = "";
    message = "";
    await updateAlarm();
  }
  publish();
}

async function maintenance() {
  if (!await loadSession() || !credential) return;
  if (!(Date.parse(credential.candidate_token_expires_at) > Date.now())) { await loseCredential(); return; }
  if (pendingEnd()) {
    // A queued user command owns its first pre-stop flush. An alarm that was
    // queued just before the click must not send the stop ahead of it.
    if (!endingCommands) await finishEnd(false);
  } else {
    await updateAlarm();
    if (session.armed && await refresh()) await flushQueue();
  }
}

async function handle(command) {
  if (!await loadSession(command.sessionId)) return { ...view(), state: null, collecting: false,
    canClear: false, message: "The saved interview changed. Reopen the popup." };
  if (credential && Date.parse(credential.candidate_token_expires_at) <= Date.now()) await loseCredential();
  if (command.action === "clear") {
    if (view().canClear) {
      pauseCollection();
      await local.remove(["joinedInterview", "candidateCredential", "monitoringSession",
        endKey(session.sessionId), withdrawKey(session.sessionId)]);
      endRequests.delete(session.sessionId);
      session = credential = null;
      verified = false;
      message = "";
      await updateAlarm();
      return { ...view(), cleared: true };
    }
    return { ...view(), message: "Check the interview state and finish monitoring before clearing it." };
  }
  if (!credential) return view();
  if (pendingEnd()) {
    if (command.intentWriteFailed) {
      // Fall back to the existing record if the dedicated marker could not be
      // written. Still attempt the server transition if storage is unavailable.
      session.endIntent = pendingEnd();
      try { await save(); } catch {
        endWarning = " Chrome could not save the pending request. Keep Chrome open and retry.";
      }
    }
    // Only the original command may flush. A retry never sends events because
    // an earlier stop might already have committed despite a lost response.
    if (command.action === "stop" || command.action === "withdraw" ||
        (command.action === "state" && !endingCommands)) await finishEnd(command.flushFirst);
    return view();
  }
  if (command.action === "state") {
    if (session.state) publish();
    if (await refresh()) scheduleUpload();
    return view();
  }
  if (!verified && !await refresh()) return view();
  const { consent, monitoring } = session.state;
  if (command.action === "start" && (!hasConsent(session.state) || monitoring.status === "STOPPED"))
    return { ...view(), message: "Starting requires current consent and an interview that can still be monitored." };
  if (command.action === "grant" && command.consentVersion !== consent.required_version)
    return { ...view(), message: "The disclosure version changed. Review the current disclosure before granting consent." };
  try {
    if (command.action === "start") {
      session.armed = true; // Recover a start whose response is lost, only after a confirming GET.
      await save();
      await ensureAlarm();
      if (pendingEnd()) return view();
      await acceptState(await candidateRequest(credential, "monitoring/start", "POST"));
    } else if (["decline", "grant"].includes(command.action)) {
      const body = command.action === "grant"
        ? { decision: "GRANTED", consent_version: command.consentVersion } : { decision: "DECLINED" };
      await acceptState(await candidateRequest(credential, "consent", "POST", body));
    }
    message = "";
  } catch (error) {
    if (authFailure(error)) await loseCredential();
    else {
      await refresh();
      message = error.code === "CONSENT_VERSION_MISMATCH" ? "Review the updated consent version before granting consent."
        : "The requested change could not be confirmed. Check the interview status before trying again.";
    }
  }
  publish();
  return view();
}

chrome.runtime.onMessage.addListener((command, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html") ||
      !command || typeof command.sessionId !== "string" || !command.sessionId ||
      !["state", "grant", "decline", "withdraw", "start", "stop", "clear"].includes(command.action)) return;
  const { sessionId, action, consentVersion } = command;
  let durableIntent;
  let flushFirst = false;
  if (["stop", "withdraw"].includes(action) && (!session || session.sessionId === sessionId)) {
    const existing = endRequests.get(sessionId);
    const intent = existing === "withdraw" ? existing : action;
    flushFirst = !existing && verified && session?.armed && intent === "stop";
    endRequests.set(sessionId, intent);
    pauseCollection();
    publish();
    const key = intent === "withdraw" ? withdrawKey(sessionId) : endKey(sessionId);
    durableIntent = local.set({ [key]: intent }).catch(() => false);
    endingCommands++;
  }
  enqueue(async () => {
    try {
      const intentWriteFailed = (await durableIntent) === false;
      return await handle({ action, sessionId, consentVersion, flushFirst, intentWriteFailed });
    } finally {
      if (durableIntent) endingCommands--;
    }
  }).then(respond, () => respond(view()));
  return true;
});

// Register wake sources synchronously. Activity listeners are attached only
// after an authenticated response has confirmed an explicitly started session.
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) wake(); });
chrome.runtime.onStartup.addListener(wake);
chrome.runtime.onInstalled.addListener(wake);
wake();
