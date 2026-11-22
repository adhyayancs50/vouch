import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../join-session.js", import.meta.url), "utf8");
const config = await readFile(new URL("../backend-config.js", import.meta.url), "utf8");
const testEventSource = await readFile(new URL("../test-event.js", import.meta.url), "utf8");
const monitoringSource = await readFile(new URL("../popup.js", import.meta.url), "utf8");
const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const confirmation = {
  success: true,
  session_id: "sess_7255a0ce3b844db1b154d2e26429ea73",
  title: "Backend Engineer Interview",
  status: "JOINED",
  policy: { ai_usage: "PARTIALLY_ALLOWED", allowed_domains: ["docs.python.org"], restricted_domains: ["chatgpt.com", "claude.ai"] },
  candidate_id: "cand_e3668da15ce7439bb5bc1b790ec81db7",
  candidate_name: "Jordan Lee",
  joined_at: "2026-11-14T05:13:32.404724Z",
  candidate_token: "vct_one_time_test_credential",
  token_type: "Bearer",
  candidate_token_expires_at: "2026-11-18T12:00:00Z",
  required_consent_version: "2026-11-monitoring-v1",
};

function workerView(joined, consent = "NONE", monitoring = "NOT_STARTED", fields = {}) {
  return {
    state: {
      session_id: joined.session_id, candidate_id: joined.candidate_id, title: joined.title, policy: joined.policy,
      consent: { status: consent, consent_version: consent === "GRANTED" ? confirmation.required_consent_version : null,
        required_version: confirmation.required_consent_version },
      monitoring: { status: monitoring },
    },
    collecting: monitoring === "ACTIVE", pending: null, needsCode: false, canClear: monitoring !== "ACTIVE",
    message: "", ...fields,
  };
}

class Element {
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  dataset = {};
  attributes = {};
  children = [];
  listeners = {};
  addEventListener(type, handler) { this.listeners[type] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren() { this.children = []; }
  append(child) { this.children.push(child); }
  focus() { this.focused = true; }
  set innerHTML(_) { throw new Error("Backend content must be rendered as text."); }
}

const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

async function popup(options = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  const stored = structuredClone(options.saved || {});
  const requests = [];
  const writes = [];
  const runtimeCalls = [];
  const accessLevels = [];
  let receiveMessage;
  const timers = new Map();
  let now = Date.parse("2026-11-17T12:00:00Z");
  let nextTimer = 1;
  const context = vm.createContext({
    document: {
      getElementById: id => { assert.ok(elements.has(id), `Missing popup element: ${id}`); return elements.get(id); },
      createElement: tag => { assert.equal(tag, "li"); return new Element(); },
    },
    chrome: {
      storage: { local: {
        setAccessLevel: async settings => {
          accessLevels.push(settings.accessLevel);
          if (options.accessFails) throw new Error("storage access unavailable");
        },
        get: async () => { if (options.getFails) throw new Error("storage unavailable"); return structuredClone(stored); },
        set: async value => {
          if (options.setFails) throw new Error("storage full");
          const copy = JSON.parse(JSON.stringify(value));
          writes.push(copy);
          Object.assign(stored, copy);
        },
        remove: async key => { if (options.removeFails) throw new Error("storage unavailable"); delete stored[key]; },
      }, onChanged: { addListener() {} } },
      runtime: {
        id: "vouch-test",
        onMessage: { addListener(handler) { receiveMessage = handler; } },
        sendMessage: async value => {
          const message = JSON.parse(JSON.stringify(value));
          runtimeCalls.push(message);
          if (options.worker) return options.worker(message, stored);
          if (value.action === "clear") {
            if (options.removeFails) throw new Error("storage unavailable");
            delete stored.joinedInterview;
            delete stored.candidateCredential;
            return { cleared: true };
          }
          assert.equal(value.action, "state");
          return stored.candidateCredential ? workerView(stored.joinedInterview) : {
            state: null, collecting: false, pending: null, needsCode: true, canClear: true,
            message: "Ask your employer for a new interview code.",
          };
        },
      },
      tabs: new Proxy({}, { get() { throw new Error("Joining must not access browser tabs."); } }),
    },
    URL, AbortController,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, request) => {
      assert.deepEqual(accessLevels, ["TRUSTED_CONTEXTS"]);
      requests.push({ url: String(url), ...request });
      return options.fetch ? options.fetch(url, request) : reply(200, confirmation);
    },
  });
  vm.runInContext(config, context);
  vm.runInContext(monitoringSource, context);
  vm.runInContext(source, context);
  if (options.includeDevelopmentTools) {
    vm.runInContext(testEventSource, context);
  }
  await flush();
  return {
    elements, stored, requests, writes, runtimeCalls, accessLevels,
    click: id => elements.get(id).listeners.click(),
    push(view, sessionId = confirmation.session_id, sender = { id: "vouch-test" }) {
      receiveMessage({ action: "monitoringUpdate", sessionId, view }, sender);
    },
    element: id => elements.get(id),
    async submit(code = "SWY8-BSFT-3XS6-F4GH", name = "") {
      elements.get("join-code").value = code;
      elements.get("candidate-name").value = name;
      await elements.get("join-form").listeners.submit({ preventDefault() {} });
    },
    async clear() { await elements.get("clear-joined-interview").listeners.click(); },
    async advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.due;
        timers.delete(id);
        timer.callback();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

test("does not fetch or start monitoring when opened; rejects blank code locally", async () => {
  const app = await popup();
  assert.equal(app.requests.length, 0);
  await app.submit("   ", "");
  assert.equal(app.requests.length, 0);
  assert.match(app.element("join-status").textContent, /Enter the interview join code/);
  assert.equal(app.element("join-code").attributes["aria-invalid"], "true");
  assert.deepEqual(app.runtimeCalls, []);
});

test("sends only the code and optional trimmed name; saves the credential privately with the interview", async () => {
  const original = { session: { active: false }, events: [{ event_type: "TAB_SWITCH" }] };
  const app = await popup({ saved: original });
  await app.submit(" swy8 bsft 3xs6 f4gh ", " Jordan Lee ");
  assert.equal(app.requests.length, 1);
  const request = app.requests[0];
  assert.equal(request.url, "http://127.0.0.1:8000/api/sessions/join");
  assert.equal(request.method, "POST");
  assert.deepEqual(JSON.parse(JSON.stringify(request.headers)), { "Content-Type": "application/json" });
  assert.equal(request.credentials, "omit");
  assert.equal(request.redirect, "error");
  assert.deepEqual(JSON.parse(request.body), { join_code: "swy8 bsft 3xs6 f4gh", candidate_name: "Jordan Lee" });
  assert.equal(app.element("interview-title").textContent, confirmation.title);
  assert.equal(app.element("interview-candidate").textContent, "Jordan Lee");
  assert.equal(app.element("interview-policy").textContent, "AI use partially allowed");
  assert.deepEqual(app.element("interview-allowed-domains").children.map(item => item.textContent), ["docs.python.org"]);
  assert.deepEqual(app.element("interview-restricted-domains").children.map(item => item.textContent), ["chatgpt.com", "claude.ai"]);
  assert.equal(app.element("joined-interview").hidden, false);
  assert.equal(app.element("join-form").hidden, true);
  assert.equal(app.element("join-code").value, "");
  assert.equal(app.stored.joinedInterview.session_id, confirmation.session_id);
  assert.equal(app.stored.joinedInterview.candidate_id, confirmation.candidate_id);
  assert.equal(JSON.stringify(app.stored).includes("swy8"), false);
  assert.equal(JSON.stringify(app.stored).includes("join_code"), false);
  assert.equal(JSON.stringify(app.stored.session), JSON.stringify(original.session));
  assert.equal(JSON.stringify(app.stored.events), JSON.stringify(original.events));
  assert.deepEqual(app.runtimeCalls, [{ action: "state", sessionId: confirmation.session_id }]);
  assert.deepEqual(app.stored.candidateCredential, {
    session_id: confirmation.session_id,
    candidate_id: confirmation.candidate_id,
    candidate_token: confirmation.candidate_token,
    token_type: "Bearer",
    candidate_token_expires_at: confirmation.candidate_token_expires_at,
    required_consent_version: confirmation.required_consent_version,
  });
  assert.deepEqual(Object.keys(app.writes[0]).sort(), ["candidateCredential", "joinedInterview"]);
  assert.equal(app.stored.joinedInterview.candidate_token, undefined);
  assert.equal([...app.elements.values()].some(item => item.textContent.includes(confirmation.candidate_token)), false);
  await app.submit();
  assert.equal(app.requests.length, 1, "Never repeat a successful join");
});

test("omits blank optional names and hides a missing returned name", async () => {
  const app = await popup({ fetch: () => reply(200, { ...confirmation, candidate_name: null }) });
  await app.submit(undefined, "   ");
  assert.deepEqual(Object.keys(JSON.parse(app.requests[0].body)), ["join_code"]);
  assert.equal(app.element("interview-candidate-row").hidden, true);
});

test("rejects an overlong candidate name without a request", async () => {
  const app = await popup();
  await app.submit(undefined, "x".repeat(121));
  assert.equal(app.requests.length, 0);
  assert.match(app.element("join-status").textContent, /120 characters/);
});

test("shows loading and prevents double submission while waiting", async () => {
  let complete;
  const app = await popup({ fetch: () => new Promise(resolve => { complete = resolve; }) });
  const pending = app.submit();
  assert.equal(app.element("join-session").disabled, true);
  assert.equal(app.element("join-session").textContent, "Joining…");
  await app.submit();
  assert.equal(app.requests.length, 1);
  complete(reply(200, confirmation));
  await pending;
  assert.equal(app.element("clear-joined-interview").disabled, false);
});

for (const [status, code, expected] of [
  [401, "INVALID_JOIN_CODE", /Invalid join code/],
  [409, "SESSION_ALREADY_JOINED", /already been used/],
  [410, "JOIN_CODE_EXPIRED", /expired/],
  [422, "VALIDATION_ERROR", /check the join code and optional name/],
  [403, "FORBIDDEN", /only local requests/],
  [404, "NOT_FOUND", /session endpoints are enabled/],
  [500, "INTERNAL_ERROR", /employer to confirm/],
]) {
  test(`handles ${status} ${code} without leaking backend output`, async () => {
    const app = await popup({ fetch: () => reply(status, { error: { code, message: "Traceback SECRET" } }) });
    await app.submit();
    assert.match(app.element("join-status").textContent, expected);
    assert.equal(app.element("join-status").textContent.includes("SECRET"), false);
    assert.equal(app.element("join-session").disabled, false);
    assert.equal(app.stored.joinedInterview, undefined);
  });
}

test("respects Retry-After seconds and persists the cooldown across popups", async () => {
  const app = await popup({ fetch: () => reply(429, { error: { code: "TOO_MANY_ATTEMPTS" } }, { "Retry-After": "3" }) });
  await app.submit();
  assert.equal(app.element("join-session").disabled, true);
  assert.match(app.element("join-retry").textContent, /3 seconds/);
  await app.submit();
  assert.equal(app.requests.length, 1);
  const reopened = await popup({ saved: app.stored });
  assert.equal(reopened.requests.length, 0);
  assert.equal(reopened.element("join-session").disabled, true);
  await reopened.advance(2999);
  assert.equal(reopened.element("join-session").disabled, true);
  await reopened.advance(1);
  assert.equal(reopened.element("join-session").disabled, false);
  assert.equal(reopened.element("join-retry").hidden, true);
});

test("accepts an HTTP-date Retry-After and provides a fallback for missing headers", async () => {
  for (const [headers, seconds] of [[{ "Retry-After": "Tue, 17 Nov 2026 12:00:04 GMT" }, 4], [{}, 60]]) {
    const app = await popup({ fetch: () => reply(429, {}, headers) });
    await app.submit();
    assert.match(app.element("join-retry").textContent, new RegExp(`${seconds} seconds`));
    await app.advance(seconds * 1000);
    assert.equal(app.element("join-session").disabled, false);
  }
});

test("restores a saved confirmation, refreshes worker state and clears through the worker", async () => {
  const first = await popup();
  await first.submit();
  const reopened = await popup({ saved: first.stored });
  assert.equal(reopened.requests.length, 0);
  assert.equal(reopened.element("interview-title").textContent, confirmation.title);
  assert.equal(reopened.element("joined-interview").hidden, false);
  assert.deepEqual(reopened.runtimeCalls.map(call => call.action), ["state"]);
  await reopened.clear();
  assert.equal(reopened.stored.joinedInterview, undefined);
  assert.equal(reopened.stored.candidateCredential, undefined);
  assert.deepEqual(reopened.runtimeCalls.map(call => call.action), ["state", "clear"]);
  assert.equal(reopened.element("join-form").hidden, false);
  assert.equal(reopened.requests.length, 0, "Clearing is local only");
  assert.match(reopened.element("join-status").textContent, /new, unused code/);
});

test("retains successful in-memory details and warns if saving fails", async () => {
  const app = await popup({ setFails: true });
  await app.submit();
  assert.equal(app.element("joined-interview").hidden, false);
  assert.match(app.element("join-status").textContent, /joined successfully/);
  assert.match(app.element("join-storage-warning").textContent, /new interview code/);
  assert.equal(app.element("collection-status").textContent, "Off");
  assert.deepEqual(app.runtimeCalls, []);
  await app.submit();
  assert.equal(app.requests.length, 1);
});

test("explains unavailable or invalid saved state without attempting to rejoin", async () => {
  for (const options of [{ getFails: true }, { saved: { joinedInterview: { session_id: "broken" } } }]) {
    const app = await popup(options);
    assert.equal(app.requests.length, 0);
    assert.equal(app.element("join-session").disabled, Boolean(options.getFails));
    assert.match(app.element("join-storage-warning").textContent, /do not reuse/i);
  }
});

test("a failed clear keeps the joined details visible", async () => {
  const app = await popup({ saved: { joinedInterview: confirmation }, removeFails: true });
  await app.clear();
  assert.equal(app.element("joined-interview").hidden, false);
  assert.match(app.element("monitoring-message").textContent, /Could not clear/);
});

test("handles network failures and timeouts without retrying the single-use code", async () => {
  const offline = await popup({ fetch: () => { throw new TypeError("Failed to fetch"); } });
  await offline.submit();
  assert.equal(offline.requests.length, 1);
  assert.match(offline.element("join-status").textContent, /Cannot connect/);
  assert.equal(offline.element("join-code").value, "");
  const timeout = await popup({ fetch: (_, request) => new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  const pending = timeout.submit();
  await timeout.advance(10000);
  await pending;
  assert.equal(timeout.requests.length, 1);
  assert.match(timeout.element("join-status").textContent, /timed out/);
  assert.match(timeout.element("join-status").textContent, /employer to confirm/);
});

test("does not claim success for a wrong status, bad JSON, or missing policy", async () => {
  for (const fetch of [
    () => reply(201, confirmation),
    () => new Response("Traceback SECRET", { status: 200 }),
    () => reply(200, { ...confirmation, policy: null }),
    () => reply(200, { ...confirmation, success: "true" }),
  ]) {
    const app = await popup({ fetch });
    await app.submit();
    assert.equal(app.stored.joinedInterview, undefined);
    assert.match(app.element("join-status").textContent, /did not return complete join details/);
    assert.equal(app.element("join-status").textContent.includes("SECRET"), false);
  }
});

test("renders every policy value, empty domain lists, and backend text safely", async () => {
  for (const [ai_usage, label] of [["PROHIBITED", "prohibited"], ["PARTIALLY_ALLOWED", "partially allowed"], ["ALLOWED", "allowed"]]) {
    const app = await popup({ fetch: () => reply(200, { ...confirmation, title: "<img src=x onerror=alert(1)>", policy: { ai_usage, allowed_domains: [], restricted_domains: [] } }) });
    await app.submit();
    assert.equal(app.element("interview-title").textContent, "<img src=x onerror=alert(1)>");
    assert.match(app.element("interview-policy").textContent, new RegExp(label));
    assert.equal(app.element("interview-allowed-domains").children[0].textContent, "None specified");
    assert.equal(app.element("interview-restricted-domains").children[0].textContent, "None specified");
  }
});

test("does not persist unexpected credential fields returned by a backend", async () => {
  const app = await popup({ fetch: () => reply(200, { ...confirmation, join_code: "NEVER_SAVE_THIS", token: "NOT_A_CANDIDATE_TOKEN" }) });
  await app.submit();
  assert.equal(JSON.stringify(app.stored).includes("NEVER_SAVE_THIS"), false);
  assert.equal(JSON.stringify(app.stored).includes("NOT_A_CANDIDATE_TOKEN"), false);
  assert.equal(app.stored.joinedInterview.session_id, confirmation.session_id);
});

test("unknown error codes cannot expose inherited object functions", async () => {
  const app = await popup({ fetch: () => reply(500, { error: { code: "constructor", message: "Traceback SECRET" } }) });
  await app.submit();
  assert.match(app.element("join-status").textContent, /backend could not complete/);
  assert.equal(app.element("join-status").textContent.includes("function"), false);
});

test("manual synthetic connection test remains independent of candidate monitoring", async () => {
  const app = await popup({ includeDevelopmentTools: true, fetch: url => String(url).endsWith("/api/dev/events")
    ? reply(201, { success: true, event_id: "evt_test", session_id: "test-session-001" })
    : reply(200, confirmation) });
  await app.element("send-test-event").listeners.click();
  assert.equal(app.element("test-event-status").textContent, "Test event sent successfully!");
  await app.submit();
  await app.element("send-test-event").listeners.click();
  assert.equal(app.requests.length, 3);
  assert.match(app.element("join-status").textContent, /joined successfully/);
  assert.equal(app.element("test-event-status").textContent, "Test event sent successfully!");
  assert.equal(app.element("collection-status").textContent, "Off");
  assert.deepEqual(app.runtimeCalls.map(call => call.action), ["state"]);
});

test("fails closed before consuming a join code when trusted storage is unavailable", async () => {
  const app = await popup({ accessFails: true });
  await app.submit();
  assert.deepEqual(app.accessLevels, ["TRUSTED_CONTEXTS"]);
  assert.equal(app.requests.length, 0);
  assert.equal(app.element("join-session").disabled, true);
});

test("handles legacy sessions and malformed or missing join credentials without token recovery", async () => {
  for (const fields of [
    { candidate_token: undefined }, { candidate_token: "bad\nheader" },
    { token_type: "Basic" }, { required_consent_version: null }, { candidate_token_expires_at: "no date" },
    { candidate_token_expires_at: "2020-01-01T00:00:00Z" },
  ]) {
    const app = await popup({ fetch: () => reply(200, { ...confirmation, ...fields }) });
    await app.submit();
    assert.equal(app.stored.candidateCredential, null);
    assert.equal(app.element("start-monitoring").disabled, true);
    assert.match(app.element("monitoring-message").textContent, /new interview code/);
    assert.equal(app.requests.length, 1);
  }
  const app = await popup({ saved: { joinedInterview: { ...confirmation, candidate_token: undefined } } });
  assert.deepEqual(app.runtimeCalls.map(call => call.action), ["state"]);
  assert.equal(app.element("clear-joined-interview").disabled, false);
  assert.equal(app.element("grant-consent").disabled, true);
  assert.match(app.element("monitoring-message").textContent, /new interview code/);
});

test("allows a new code after a pending stop loses its credential without claiming backend confirmation", async () => {
  const app = await popup({ saved: { joinedInterview: confirmation }, worker: ({ action }) => action === "clear" ? { cleared: true }
    : workerView(confirmation, "GRANTED", "ACTIVE", { pending: "stop", collecting: false, canClear: true, needsCode: true,
      message: "The backend could not confirm your stop. Ask your employer for a new interview code." }) });
  assert.equal(app.element("monitoring-status").textContent, "ACTIVE");
  assert.equal(app.element("collection-status").textContent, "Off");
  assert.match(app.element("monitoring-message").textContent, /could not confirm/);
  assert.equal(app.element("clear-joined-interview").disabled, false);
  await app.clear();
  assert.equal(app.element("join-form").hidden, false);
});

test("renders authoritative policy, consent and monitoring across candidate actions", async () => {
  let current = workerView({ ...confirmation, title: "Updated interview", policy: { ...confirmation.policy, ai_usage: "PROHIBITED" } });
  const app = await popup({ worker: ({ action, consentVersion }) => {
    const state = current.state;
    if (action === "decline") current = workerView(state, "DECLINED");
    if (action === "grant") {
      assert.equal(consentVersion, state.consent.required_version);
      current = workerView(state, "GRANTED");
    }
    if (action === "start") current = workerView(state, "GRANTED", "ACTIVE");
    if (action === "withdraw") current = workerView(state, "WITHDRAWN", "STOPPED");
    return current;
  } });
  await app.submit();
  assert.equal(app.element("interview-title").textContent, "Updated interview");
  assert.equal(app.element("interview-policy").textContent, "AI use prohibited");
  assert.equal(app.element("policy-disclosure").open, true);
  assert.equal(app.element("consent-version").textContent, confirmation.required_consent_version);
  assert.equal(app.element("start-monitoring").disabled, true);
  await app.click("start-monitoring");
  await app.click("decline-consent");
  assert.equal(app.element("consent-status").textContent, "DECLINED");
  assert.equal(app.element("start-monitoring").disabled, true);
  await app.click("grant-consent");
  assert.equal(app.element("policy-disclosure").open, false);
  assert.equal(app.element("collection-status").textContent, "Off");
  assert.equal(app.element("start-monitoring").disabled, false);
  await app.click("start-monitoring");
  assert.equal(app.element("monitoring-status").textContent, "ACTIVE");
  assert.equal(app.element("collection-status").textContent, "Running");
  assert.equal(app.element("clear-joined-interview").disabled, true);
  await app.click("withdraw-consent");
  assert.equal(app.element("monitoring-status").textContent, "STOPPED");
  assert.equal(app.element("consent-status").textContent, "WITHDRAWN");
  assert.equal(app.element("start-monitoring").hidden, true);
  assert.equal(app.element("grant-consent").hidden, true);
  assert.deepEqual(app.runtimeCalls.map(call => call.action), ["state", "decline", "grant", "start", "withdraw"]);
});

test("a changed disclosure requires the candidate to review and grant the displayed version", async () => {
  const old = workerView(confirmation, "GRANTED");
  old.state.consent.required_version = "2026-11-monitoring-v2";
  const app = await popup({ worker: () => old });
  await app.submit();
  assert.equal(app.element("grant-consent").disabled, false);
  assert.equal(app.element("policy-disclosure").open, true);
  assert.equal(app.element("start-monitoring").hidden, true);
  await app.click("grant-consent");
  assert.equal(app.runtimeCalls.at(-1).consentVersion, "2026-11-monitoring-v2");
});

test("stop interrupts a refresh and an older reply cannot restart a stopped popup", async () => {
  const active = workerView(confirmation, "GRANTED", "ACTIVE");
  let resolveRefresh;
  let resolveStop;
  const app = await popup({
    saved: { joinedInterview: confirmation },
    worker: ({ action }) => new Promise(resolve => {
      if (action === "state") resolveRefresh = resolve;
      if (action === "stop") resolveStop = resolve;
    }),
  });
  app.push(active);
  assert.equal(app.element("stop-monitoring").disabled, false);
  const stopping = app.click("stop-monitoring");
  assert.equal(app.element("stop-monitoring").disabled, true);
  app.push({ ...active, collecting: false, pending: "stop", message: "Waiting for backend confirmation." });
  assert.equal(app.element("monitoring-status").textContent, "ACTIVE");
  assert.equal(app.element("collection-status").textContent, "Off");
  assert.match(app.element("monitoring-message").textContent, /confirmation/);
  resolveStop(workerView(confirmation, "GRANTED", "STOPPED"));
  await stopping;
  resolveRefresh(active);
  await flush();
  app.push(active);
  assert.equal(app.element("monitoring-status").textContent, "STOPPED");
  assert.equal(app.element("collection-status").textContent, "Off");
  assert.deepEqual(app.runtimeCalls.map(call => call.action), ["state", "stop"]);
});

test("opening the popup allows a stop request before the first state reply and ignores unrelated pushes", async () => {
  let resolveRefresh;
  const app = await popup({
    saved: { joinedInterview: confirmation },
    worker: ({ action }) => action === "state" ? new Promise(resolve => { resolveRefresh = resolve; })
      : workerView(confirmation, "GRANTED", "ACTIVE", { pending: "stop", collecting: false }),
  });
  const stopped = workerView(confirmation, "GRANTED", "STOPPED");
  app.push(stopped, "different-session");
  app.push(stopped, confirmation.session_id, { id: "another-extension" });
  app.push(stopped, confirmation.session_id, { id: "vouch-test", tab: { id: 2 } });
  assert.equal(app.element("monitoring-status").textContent, "Unconfirmed");
  await app.click("stop-monitoring");
  assert.match(app.element("monitoring-message").textContent, /backend confirmation/);
  resolveRefresh(stopped);
  await flush();
  assert.equal(app.element("monitoring-status").textContent, "ACTIVE");
  assert.equal(app.element("start-monitoring").disabled, true);
});
