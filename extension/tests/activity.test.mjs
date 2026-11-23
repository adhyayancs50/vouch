import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../activity.js", import.meta.url), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));

function chromeEvent() {
  const listeners = new Set();
  return {
    addListener(fn) { listeners.add(fn); },
    removeListener(fn) { listeners.delete(fn); },
    fire(...args) { for (const fn of listeners) fn(...args); },
    get size() { return listeners.size; },
  };
}

function fixture() {
  const foreground = { id: 8, focused: true, incognito: false, type: "normal" };
  const current = { id: 17, active: true, incognito: false, windowId: 8, url: "https://example.org/welcome" };
  const chrome = {
    windows: {
      WINDOW_ID_NONE: -1, onFocusChanged: chromeEvent(),
      getLastFocused: async () => foreground,
      get: async id => ({ ...foreground, id }),
    },
    tabs: {
      onActivated: chromeEvent(), onUpdated: chromeEvent(),
      query: async () => [current],
      get: async id => ({ ...current, id }),
    },
  };
  const events = [];
  const factory = vm.runInNewContext(source + "\ncreateActivityCollector", { URL });
  const collector = factory(chrome, event => events.push({ ...event }));
  const activate = (tabId, windowId = 8) => chrome.tabs.onActivated.fire({ tabId, windowId });
  const navigate = (url, overrides = {}) => {
    const tab = { ...current, url, ...overrides };
    chrome.tabs.onUpdated.fire(tab.id, { url }, tab);
  };
  return { chrome, events, collector, current, activate, navigate };
}

test("attaches only during active collection; start and stop are idempotent", async () => {
  const { chrome, events, collector, activate, navigate } = fixture();
  let lookups = 0;
  const lastFocused = chrome.windows.getLastFocused;
  chrome.windows.getLastFocused = () => { lookups++; return lastFocused(); };
  const listeners = [chrome.tabs.onUpdated, chrome.tabs.onActivated, chrome.windows.onFocusChanged];
  activate(19);
  navigate("https://hidden.test/");
  assert.ok(listeners.every(event => event.size === 0));
  assert.equal(lookups, 0);
  collector.start();
  collector.start();
  await settle();
  assert.ok(listeners.every(event => event.size === 1));
  assert.equal(lookups, 1);
  assert.equal(events.length, 0);
  activate(19);
  collector.stop();
  collector.stop();
  assert.ok(listeners.every(event => event.size === 0));
  activate(20);
  navigate("https://hidden.test/");
  assert.deepEqual(events.map(e => [e.event_type, e.tab_id, e.hostname]), [["TAB_SWITCH", 19, null]]);
});

test("emits just hostname changes for the focused tab, including IDNA and switches from non-web pages", async () => {
  const { collector, events, chrome, current, navigate } = fixture();
  collector.start();
  await settle();
  navigate("https://EXAMPLE.org.:443/private-path?secret#fragment");
  navigate("https://user:secret@bücher.test:9443/private-path?secret#fragment");
  navigate("http://xn--bcher-kva.test/another");
  chrome.tabs.onUpdated.fire(current.id, { title: "secret" }, current);
  for (const url of ["chrome://settings", "file:///private-path", "data:text/plain,secret",
    "https://[::1]/private-path", "https://invalid_domain.test", "not a URL"]) navigate(url);
  navigate("http://localhost:8000/secret");
  assert.deepEqual(events.map(e => e.hostname), ["xn--bcher-kva.test", "localhost"]);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ["event_type", "hostname", "occurred_at", "tab_id"]);
    assert.equal(event.tab_id, current.id);
    assert.equal(event.event_type, "WEBSITE_NAVIGATION");
    assert.equal(new Date(event.occurred_at).toISOString(), event.occurred_at);
  }
  assert.doesNotMatch(JSON.stringify(events), /secret|private-path|:9443|fragment/);
});

test("excludes inactive, incognito, and unfocused windows and tabs", async () => {
  const { chrome, collector, events, activate, navigate } = fixture();
  collector.start();
  await settle();
  navigate("https://background.test", { active: false });
  navigate("https://private.test", { incognito: true });
  activate(22, 99);
  navigate("https://other-window.test", { windowId: 99 });
  chrome.windows.onFocusChanged.fire(-1);
  activate(24);
  navigate("https://while-chrome-unfocused.test");
  chrome.windows.get = async id => ({ id, focused: true, incognito: true, type: "normal" });
  chrome.windows.onFocusChanged.fire(41);
  await settle();
  activate(24, 41);
  navigate("https://private.test", { incognito: true, windowId: 41 });
  assert.deepEqual(events, []);
});

test("records switches in observed order despite delayed lookups and discards stale baselines", async () => {
  const { collector, events, chrome, current, activate, navigate } = fixture();
  const reads = new Map();
  chrome.tabs.get = id => new Promise(resolve => reads.set(id, resolve));
  collector.start();
  await settle();
  activate(30);
  activate(31);
  reads.get(31)({ ...current, id: 31, url: "https://visible.test" });
  reads.get(30)({ ...current, id: 30, url: "https://other.test" });
  await settle();
  navigate("https://visible.test/path", { id: 31 });
  navigate("https://next.test/path", { id: 31 });
  assert.deepEqual(events.map(e => [e.event_type, e.tab_id, e.hostname]), [
    ["TAB_SWITCH", 30, null], ["TAB_SWITCH", 31, null], ["WEBSITE_NAVIGATION", 31, "next.test"],
  ]);
});

test("a slow window lookup never reactivates monitoring or replaces a newer focus", async () => {
  const { collector, events, chrome, activate, navigate } = fixture();
  let finish;
  chrome.windows.getLastFocused = () => new Promise(resolve => { finish = resolve; });
  collector.start();
  const oldWindow = finish;
  collector.stop();
  collector.start();
  chrome.windows.onFocusChanged.fire(-1);
  for (const resolve of [finish, oldWindow]) resolve({ id: 8, focused: true, incognito: false, type: "normal" });
  await settle();
  activate(55);
  navigate("https://hidden.test/");
  assert.deepEqual(events, []);
});
