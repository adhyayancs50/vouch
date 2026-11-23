import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const files = Object.fromEntries(await Promise.all(["background.js", "backend-config.js", "candidate-api.js"]
  .map(async file => [file, await readFile(new URL("../" + file, import.meta.url), "utf8")])));
const settle = () => new Promise(resolve => setImmediate(resolve));
const sessionId = "sess_test";
const candidateId = "cand_test";
const version = "2026-11-monitoring-v1";
const token = "vct_test_credential";
const endKey = "monitoringEnd:" + sessionId;
const baseTime = Date.parse("2026-11-22T12:00:00Z");
const expires = new Date(baseTime + 86400000).toISOString();
const popupUrl = "chrome-extension://vouch/popup.html";
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const failure = (status, code, headers) => json({ error: { code } }, status, headers);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function backend() {
  const state = {
    session_id: sessionId, candidate_id: candidateId, title: "Interview",
    candidate_token_expires_at: expires,
    policy: { ai_usage: "ALLOWED", allowed_domains: [], restricted_domains: [] },
    consent: { status: "NONE", consent_version: null, required_version: version, updated_at: null },
    monitoring: { status: "NOT_STARTED", started_at: null, stopped_at: null, stop_reason: null, events_received: 0 },
  };
  const received = new Map();
  const requests = [];
  const server = {
    state, received, requests, intercept: null,
    async fetch(url, init) {
      const route = url.pathname.replace("/api/sessions/" + sessionId + "/", "");
      const body = init.body && JSON.parse(init.body);
      requests.push({ route, body, url: String(url), method: init.method, headers: init.headers,
        redirect: init.redirect, credentials: init.credentials });
      if (server.intercept) {
        const response = await server.intercept(route, body);
        if (response) return response;
      }
      if (route === "candidate") return json(state);
      if (route === "consent") {
        state.consent.status = body.decision;
        if (body.decision === "GRANTED") state.consent.consent_version = body.consent_version;
        if (body.decision === "WITHDRAWN" && state.monitoring.status === "ACTIVE") {
          state.monitoring.status = "STOPPED";
          state.monitoring.stop_reason = "CONSENT_WITHDRAWN";
        }
      } else if (route === "monitoring/start") {
        if (state.consent.status !== "GRANTED") return failure(409, "CONSENT_REQUIRED");
        if (state.monitoring.status === "STOPPED") return failure(409, "MONITORING_ALREADY_STOPPED");
        state.monitoring.status = "ACTIVE";
      } else if (route === "monitoring/stop") {
        if (state.monitoring.status === "NOT_STARTED") return failure(409, "MONITORING_NOT_STARTED");
        state.monitoring.status = "STOPPED";
        state.monitoring.stop_reason = "CANDIDATE_STOPPED";
      } else if (route === "events") {
        if (state.monitoring.status !== "ACTIVE") return failure(409, "MONITORING_NOT_ACTIVE");
        const results = body.events.map(event => {
          const id = event.client_event_id;
          const status = received.has(id) ? "DUPLICATE" : "STORED";
          if (status === "DUPLICATE") assert.deepEqual(event, received.get(id));
          received.set(id, event);
          return { client_event_id: id, status, event_id: "evt_" + id };
        });
        const stored = results.filter(r => r.status === "STORED").length;
        return json({ results, stored, duplicates: results.length - stored });
      } else throw new Error("Unexpected route " + route);
      return json({ ...state, changed: true });
    },
  };
  return server;
}

function storage() {
  return {
    joinedInterview: { session_id: sessionId, candidate_id: candidateId },
    candidateCredential: { session_id: sessionId, candidate_id: candidateId, token_type: "Bearer",
      candidate_token: token, candidate_token_expires_at: expires, required_consent_version: version },
  };
}

function worker(server, disk = storage(), storageHooks = {}) {
  let now = baseTime;
  let receiver, alarmListener, onEvent;
  let active = false;
  let starts = 0;
  let nextTimer = 0;
  const timers = new Map();
  const alarms = new Map();
  const notices = [];
  const access = [];
  const chrome = {
    storage: { local: {
      setAccessLevel: async value => { access.push(value.accessLevel); },
      get: async keys => {
        storageHooks.beforeGet?.(keys);
        return Object.fromEntries([].concat(keys).filter(k => k in disk).map(k => [k, structuredClone(disk[k])]));
      },
      set: async values => {
        storageHooks.beforeSet?.(values);
        Object.assign(disk, structuredClone(values));
      },
      remove: async keys => { for (const key of [].concat(keys)) delete disk[key]; },
    } },
    runtime: { id: "vouch", getURL: path => "chrome-extension://vouch/" + path,
      sendMessage: async value => { notices.push(structuredClone(value)); },
      onMessage: { addListener(handler) { receiver = handler; } },
      onStartup: { addListener() {} }, onInstalled: { addListener() {} },
    },
    alarms: { get: async key => alarms.get(key), create: async (key, timer) => { alarms.set(key, timer); },
      clear: async key => alarms.delete(key), onAlarm: { addListener(handler) { alarmListener = handler; } } },
  };
  const context = vm.createContext({
    chrome, URL, AbortController, crypto: webcrypto, fetch: server.fetch.bind(server),
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, at: now + ms }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    createActivityCollector: (_, callback) => {
      onEvent = callback;
      return { start() { active = true; starts++; }, stop() { active = false; } };
    },
    importScripts(...paths) { for (const path of paths) if (path !== "activity.js") vm.runInContext(files[path], context); },
  });
  vm.runInContext(files["background.js"], context);
  return {
    disk, notices, access, get active() { return active; }, get starts() { return starts; },
    command(action, extra = {}) {
      return new Promise(resolve => {
        assert.equal(receiver({ action, sessionId, ...extra }, { id: "vouch", url: popupUrl }, resolve), true);
      });
    },
    sendFrom(sender) { return receiver({ action: "start", sessionId }, sender, assert.fail); },
    emit(tab_id = 1) { onEvent({ event_type: "TAB_SWITCH", tab_id, hostname: null, occurred_at: new Date(now).toISOString() }); },
    async advance(ms) {
      const end = now + ms;
      let timer;
      while ((timer = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0])) {
        const [id, { fn, at }] = timer;
        timers.delete(id);
        now = at;
        fn();
        await settle();
      }
      now = end;
    },
    async alarm() { alarmListener({ name: "vouch-monitoring" }); await settle(); },
  };
}

async function start(worker) {
  await worker.command("state");
  await worker.command("grant", { consentVersion: version });
  const result = await worker.command("start");
  assert.equal(result.collecting, true);
}

test("consent and start are distinct; only a confirmed ACTIVE response starts collection", async () => {
  const server = backend();
  const app = worker(server);
  assert.equal((await app.command("state")).state.consent.status, "NONE");
  app.emit();
  await app.command("start");
  await app.command("grant", { consentVersion: "wrong" });
  assert.deepEqual(server.requests.map(r => r.route), ["candidate"]);
  assert.equal((await app.command("decline")).state.consent.status, "DECLINED");
  assert.equal((await app.command("grant", { consentVersion: version })).collecting, false);
  assert.deepEqual(server.requests.at(-1).body, { decision: "GRANTED", consent_version: version });
  const gate = deferred();
  server.intercept = route => route === "monitoring/start" ? gate.promise : undefined;
  const pending = app.command("start");
  await settle();
  assert.equal(app.active, false);
  app.emit();
  gate.resolve();
  assert.equal((await pending).state.monitoring.status, "ACTIVE");
  assert.equal(app.active, true);
  assert.deepEqual(app.disk.monitoringSession.queue, []);
  const reopened = await app.command("state");
  assert.equal(reopened.collecting, true);
  assert.equal(app.starts, 1);
  assert.equal(app.access[0], "TRUSTED_CONTEXTS");
  for (const request of server.requests) {
    assert.equal(request.headers.Authorization, "Bearer " + token);
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "error");
    assert.ok(!request.url.includes(token));
  }
  assert.ok(!JSON.stringify([reopened, app.notices]).includes(token));
});

test("missing, expired, and rejected credentials fail closed and require a new code", async () => {
  for (const problem of ["missing", "expired", "invalid", "mismatch"]) {
    const server = backend();
    const disk = storage();
    if (problem === "missing") delete disk.candidateCredential;
    if (problem === "expired") disk.candidateCredential.candidate_token_expires_at = new Date(baseTime - 1).toISOString();
    server.intercept = () => problem === "mismatch" ? failure(403, "SESSION_MISMATCH") : failure(401, "INVALID_CANDIDATE_TOKEN");
    const app = worker(server, disk);
    const result = await app.command("state");
    assert.equal(result.needsCode, true);
    assert.match(result.message, /new interview session and code/i);
    assert.equal(disk.candidateCredential, null);
    assert.equal(app.starts, 0);
    assert.equal(server.requests.length, ["missing", "expired"].includes(problem) ? 0 : 1);
    assert.equal((await app.command("clear")).cleared, true);
  }
});

test("only the extension popup can issue candidate commands", async () => {
  const server = backend();
  const app = worker(server);
  for (const sender of [{ id: "other", url: popupUrl }, { id: "vouch", url: "https://example.org/" },
    { id: "vouch", url: "chrome-extension://vouch/another.html" }]) {
    assert.equal(app.sendFrom(sender), undefined);
  }
  await settle();
  assert.equal(server.requests.length, 0);
});

test("batches in sequence, acknowledges only matching IDs, and replays duplicate IDs unchanged", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  for (let n = 0; n < 54; n++) app.emit(n);
  await settle();
  let attempt = 0;
  server.intercept = (route, body) => {
    if (route !== "events" || ++attempt !== 1) return;
    // Simulate a committed batch whose acknowledgement could not be verified.
    for (const event of body.events) server.received.set(event.client_event_id, event);
    return json({ results: body.events.map(() => ({ status: "STORED", client_event_id: "wrong", event_id: "evt_wrong" })) });
  };
  await app.advance(750);
  assert.equal(app.disk.monitoringSession.queue.length, 54);
  await app.alarm();
  assert.equal(server.requests.filter(r => r.route === "events").length, 1);
  await app.advance(60000);
  await app.alarm();
  const batches = server.requests.filter(r => r.route === "events").map(r => r.body.events);
  assert.deepEqual(batches.map(batch => batch.length), [50, 50, 4]);
  assert.deepEqual(batches[1], batches[0]);
  assert.deepEqual([...server.received.values()].map(e => e.client_sequence), Array.from({length:54}, (_, n) => n));
  assert.equal(app.disk.monitoringSession.queue.length, 0);
  assert.equal(app.disk.monitoringSession.nextSequence, 54);
});

test("rate-limited uploads respect Retry-After across a worker restart", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  app.emit();
  await settle();
  server.intercept = route => route === "events" ? failure(429, "RATE_LIMITED", { "Retry-After": "120" }) : undefined;
  await app.advance(750);
  const initial = structuredClone(app.disk.monitoringSession.queue);
  assert.equal(initial.length, 1);
  server.intercept = null;
  const restored = worker(server, app.disk);
  await settle();
  assert.equal(restored.active, true);
  await restored.advance(120000);
  await restored.alarm();
  assert.equal(server.received.size, 0);
  await restored.advance(1000);
  await restored.alarm();
  assert.deepEqual([...server.received.values()], initial);
});

test("Stop disables local activity synchronously, flushes eligible events first, and is terminal", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  app.emit();
  const stop = app.command("stop");
  assert.equal(app.active, false);
  app.emit(2);
  const result = await stop;
  assert.equal(result.state.monitoring.status, "STOPPED");
  assert.equal(result.pending, null);
  assert.deepEqual(server.requests.slice(-2).map(r => [r.route, r.body?.events?.length]), [["events", 1], ["monitoring/stop", undefined]]);
  app.emit(3);
  await app.command("start");
  await app.alarm();
  assert.equal(app.active, false);
  assert.equal(server.received.size, 1);
  assert.equal(server.requests.at(-1).route, "monitoring/stop");
});

test("failed Stop remains pending through restart; a retry never sends any more events", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  app.emit();
  await settle();
  server.intercept = route => { if (["events", "monitoring/stop"].includes(route)) throw new TypeError("offline"); };
  const result = await app.command("stop");
  assert.equal(result.pending, "stop");
  assert.equal(result.collecting, false);
  assert.equal(result.state.monitoring.status, "ACTIVE");
  assert.equal(app.disk[endKey], "stop");
  const cut = server.requests.length;
  server.intercept = null;
  const resumed = worker(server, app.disk);
  await settle();
  assert.equal(resumed.starts, 0);
  assert.deepEqual(server.requests.slice(cut).map(r => r.route), ["monitoring/stop"]);
  assert.equal(app.disk[endKey], undefined);
  assert.equal(app.disk.monitoringSession.state.monitoring.status, "STOPPED");
  assert.equal(app.disk.monitoringSession.queue.length, 0);
});

test("withdrawal supersedes a pending stop and does not drain another batch after an in-flight upload", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  for (let n = 0; n < 51; n++) app.emit();
  await settle();
  const gate = deferred();
  server.intercept = route => route === "events" ? gate.promise : undefined;
  await app.advance(750);
  assert.equal(server.requests.at(-1).route, "events");
  const stop = app.command("stop");
  const withdraw = app.command("withdraw");
  assert.equal(app.active, false);
  assert.equal(app.disk["monitoringWithdraw:" + sessionId], "withdraw");
  app.emit();
  gate.resolve();
  await stop;
  const result = await withdraw;
  assert.equal(result.state.consent.status, "WITHDRAWN");
  assert.equal(result.state.monitoring.status, "STOPPED");
  assert.equal(result.pending, null);
  assert.equal(server.received.size, 50);
  assert.equal(server.requests.filter(r => r.route === "monitoring/stop").length, 0);
  assert.deepEqual(server.requests.at(-1).body, { decision: "WITHDRAWN" });
});

test("a cold worker preserves durable withdrawal when Stop arrives before startup recovery has finished", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  server.intercept = route => { if (route === "consent") throw new TypeError("offline"); };
  assert.equal((await app.command("withdraw")).pending, "withdraw");
  server.intercept = null;
  const resumed = worker(server, app.disk);
  const result = await resumed.command("stop");
  assert.equal(result.state.consent.status, "WITHDRAWN");
  assert.equal(server.requests.filter(r => r.route === "monitoring/stop").length, 0);
  assert.equal(resumed.starts, 0);
});

test("recovery verifies ACTIVE, and stops before dispatching queued events if the server reports termination", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  app.emit();
  await settle();
  const gate = deferred();
  server.intercept = route => route === "candidate" ? gate.promise : undefined;
  const restarted = worker(server, app.disk);
  await settle();
  assert.equal(restarted.active, false);
  server.state.monitoring.status = "STOPPED";
  gate.resolve();
  await settle();
  assert.equal(restarted.starts, 0);
  assert.equal(app.disk.monitoringSession.queue.length, 0);
  assert.equal(server.received.size, 0);
});

test("bounded queue pauses recording and can still drain on an explicit Stop", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  for (let n = 0; n < 300; n++) app.emit(n);
  await settle();
  const queued = app.disk.monitoringSession.queue.length;
  assert.ok(queued > 0 && queued < 300);
  assert.equal(app.active, false);
  await app.command("stop");
  assert.equal(server.received.size, queued);
  assert.equal(server.requests.at(-1).route, "monitoring/stop");
});

test("a temporarily unverified worker resumes timed uploads after the backend confirms ACTIVE again", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  app.emit();
  await settle();
  server.intercept = route => { if (route === "candidate") throw new TypeError("offline"); };
  assert.equal((await app.command("state")).collecting, false);
  server.intercept = null;
  assert.equal((await app.command("state")).collecting, true);
  await app.advance(1000);
  assert.equal(server.received.size, 1);
});

test("an alarm queued just before Stop lets the first stop request flush eligible events", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  app.emit(1);
  app.emit(2);
  await settle();
  const alarm = app.alarm();
  const result = await app.command("stop");
  await alarm;
  assert.equal(result.state.monitoring.status, "STOPPED");
  assert.deepEqual([...server.received.values()].map(event => event.tab_id), [1, 2]);
  assert.deepEqual(server.requests.slice(-2).map(request => request.route), ["events", "monitoring/stop"]);
});

test("validation errors discard only the rejected event and preserve the other IDs and sequences", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  for (const tab of [11, 22, 33]) app.emit(tab);
  await settle();
  const original = structuredClone(app.disk.monitoringSession.queue);
  server.intercept = (route, body) => {
    if (route === "events" && body.events.some(event => event.tab_id === 22)) {
      return json({ error: { code: "EVENT_TIMESTAMP_OUT_OF_RANGE", details: [
        { location: "body.events.1.occurred_at", type: "out_of_range" },
      ] } }, 422);
    }
  };
  await app.advance(750);
  assert.deepEqual([...server.received.values()], [original[0], original[2]]);
  assert.equal(app.disk.monitoringSession.lost, 1);
  assert.equal(app.disk.monitoringSession.queue.length, 0);
});

test("a backend event limit pauses collection and still permits an explicit stop", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  server.intercept = route => route === "events" ? failure(409, "EVENT_LIMIT_REACHED") : undefined;
  app.emit();
  await app.advance(1000);
  await app.alarm();
  assert.equal(app.active, false);
  assert.equal(server.requests.filter(request => request.route === "events").length, 1);
  assert.equal((await app.command("stop")).state.monitoring.status, "STOPPED");
});

test("a failed read of the stop marker cannot re-enable collection on the next popup refresh", async () => {
  const server = backend();
  const app = worker(server);
  await start(app);
  server.intercept = route => { if (route === "monitoring/stop") throw new TypeError("offline"); };
  await app.command("stop");
  let failRead = true;
  const restored = worker(server, app.disk, { beforeGet(keys) {
    if (failRead && keys.includes(endKey)) {
      failRead = false;
      throw new Error("Storage temporarily unavailable");
    }
  } });
  await settle();
  server.intercept = null;
  assert.equal((await restored.command("state")).state.monitoring.status, "STOPPED");
  assert.equal(restored.starts, 0);
});

test("a failed stop marker write falls back to the session record before retrying offline Stop", async () => {
  const server = backend();
  const app = worker(server, storage(), { beforeSet(values) {
    if (endKey in values) throw new Error("Marker write failed");
  } });
  await start(app);
  server.intercept = route => { if (route === "monitoring/stop") throw new TypeError("offline"); };
  assert.equal((await app.command("stop")).pending, "stop");
  assert.equal(app.disk[endKey], undefined);
  server.intercept = null;
  const restored = worker(server, app.disk);
  await settle();
  assert.equal((await restored.command("state")).state.monitoring.status, "STOPPED");
  assert.equal(restored.starts, 0);
});
