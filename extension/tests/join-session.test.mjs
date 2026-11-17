import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../join-session.js", import.meta.url), "utf8");
const config = await readFile(new URL("../backend-config.js", import.meta.url), "utf8");
const testEventSource = await readFile(new URL("../test-event.js", import.meta.url), "utf8");
const legacySource = await readFile(new URL("../popup.js", import.meta.url), "utf8");
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
};

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
        get: async () => { if (options.getFails) throw new Error("storage unavailable"); return structuredClone(stored); },
        set: async value => {
          if (options.setFails) throw new Error("storage full");
          const copy = JSON.parse(JSON.stringify(value));
          writes.push(copy);
          Object.assign(stored, copy);
        },
        remove: async key => { if (options.removeFails) throw new Error("storage unavailable"); delete stored[key]; },
      }, onChanged: { addListener() {} } },
      runtime: { sendMessage: value => { runtimeCalls.push(value); throw new Error("Joining must not start tracking."); } },
      tabs: new Proxy({}, { get() { throw new Error("Joining must not access browser tabs."); } }),
    },
    URL, AbortController,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, request) => {
      requests.push({ url: String(url), ...request });
      return options.fetch ? options.fetch(url, request) : reply(200, confirmation);
    },
  });
  vm.runInContext(config, context);
  vm.runInContext(source, context);
  if (options.includeDevelopmentTools) {
    vm.runInContext(testEventSource, context);
    vm.runInContext(legacySource, context);
  }
  await flush();
  return {
    elements, stored, requests, writes, runtimeCalls,
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

test("sends only the code and optional trimmed name; displays policy and saves no credential", async () => {
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
  assert.deepEqual(app.runtimeCalls, []);
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

test("restores a saved confirmation without any resume or join request", async () => {
  const first = await popup();
  await first.submit();
  const reopened = await popup({ saved: first.stored });
  assert.equal(reopened.requests.length, 0);
  assert.equal(reopened.element("interview-title").textContent, confirmation.title);
  assert.equal(reopened.element("joined-interview").hidden, false);
  assert.match(reopened.element("join-status").textContent, /saved join confirmation/);
  await reopened.clear();
  assert.equal(reopened.stored.joinedInterview, undefined);
  assert.equal(reopened.element("join-form").hidden, false);
  assert.equal(reopened.requests.length, 0, "Clearing is local only");
  assert.match(reopened.element("join-status").textContent, /new, unused code/);
});

test("retains successful in-memory details and warns if saving fails", async () => {
  const app = await popup({ setFails: true });
  await app.submit();
  assert.equal(app.element("joined-interview").hidden, false);
  assert.match(app.element("join-status").textContent, /joined successfully/);
  assert.match(app.element("join-storage-warning").textContent, /Do not reuse the code/);
  await app.submit();
  assert.equal(app.requests.length, 1);
});

test("explains unavailable or invalid saved state without attempting to rejoin", async () => {
  for (const options of [{ getFails: true }, { saved: { joinedInterview: { session_id: "broken" } } }]) {
    const app = await popup(options);
    assert.equal(app.requests.length, 0);
    assert.equal(app.element("join-session").disabled, false);
    assert.match(app.element("join-storage-warning").textContent, /do not reuse/i);
  }
});

test("a failed clear keeps the joined details visible", async () => {
  const app = await popup({ saved: { joinedInterview: confirmation }, removeFails: true });
  await app.clear();
  assert.equal(app.element("joined-interview").hidden, false);
  assert.match(app.element("join-status").textContent, /Could not clear/);
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

test("Send Test Event and the legacy popup coexist with the join flow", async () => {
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
  assert.equal(app.element("status").textContent, "Not recording");
  assert.deepEqual(app.runtimeCalls, []);
});
