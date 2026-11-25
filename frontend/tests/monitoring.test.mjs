import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const server = await createServer({
  configFile: false,
  plugins: [react()],
  server: { middlewareMode: true, hmr: false, ws: false },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://127.0.0.1:8000'),
    'import.meta.env.VITE_DEV_EMPLOYER_KEY': JSON.stringify('test-employer-001'),
  },
})
after(() => server.close())
const monitoring = await server.ssrLoadModule('/src/monitoring.ts')
const { MonitoringStatus, ActivityTimeline } = await server.ssrLoadModule('/src/components/SessionMonitoring.tsx')
const render = (component, props) => renderToStaticMarkup(createElement(component, props))

const date = '2026-11-25T10:00:00Z'
const baseView = {
  session_id: 'sess_test', session_status: 'JOINED',
  candidate: { candidate_id: 'cand_test', name: 'Jordan', joined_at: date },
  consent: { status: 'NONE', consent_version: null, updated_at: null, history: [] },
  monitoring: { status: 'NOT_STARTED', started_at: null, stopped_at: null, stop_reason: null, events_received: 0, last_event_received_at: null },
}
const event = {
  event_id: 'evt_test', event_type: 'TAB_SWITCH', hostname: 'docs.python.org', tab_id: 0,
  occurred_at: date, received_at: date, client_sequence: 1, server_sequence: 10,
}

for (const [sessionStatus, consent, state, message] of [
  ['CREATED', 'NONE', 'NOT_STARTED', /Waiting for the candidate to join/],
  ['JOINED', 'NONE', 'NOT_STARTED', /Waiting for the candidate to grant consent/],
  ['JOINED', 'DECLINED', 'NOT_STARTED', /candidate declined consent/],
  ['JOINED', 'GRANTED', 'NOT_STARTED', /Waiting for the candidate to start monitoring/],
  ['JOINED', 'GRANTED', 'ACTIVE', /Monitoring was active at the last successful refresh/],
  ['JOINED', 'GRANTED', 'STOPPED', /Monitoring stopped/],
  ['JOINED', 'WITHDRAWN', 'STOPPED', /Consent withdrawn/],
]) {
  test(`renders ${sessionStatus}, ${consent}, ${state} as a dated snapshot`, () => {
    const view = { ...baseView, session_status: sessionStatus, consent: { ...baseView.consent, status: consent }, monitoring: { ...baseView.monitoring, status: state } }
    const html = render(MonitoringStatus, { view, fetchedAt: date })
    assert.match(html, message)
    for (const status of [sessionStatus, consent, state]) assert.ok(html.includes(status))
    assert.match(html, /State snapshot fetched/)
    assert.match(html, /not a live feed/)
    assert.match(html, /Browser events received/)
    assert.match(html, /Not recorded/)
  })
}

test('renders monitoring timestamps, stop reasons and received count', () => {
  for (const [reason, label] of [['CANDIDATE_STOPPED', 'Candidate stopped monitoring'], ['CONSENT_WITHDRAWN', 'Consent withdrawn']]) {
    const html = render(MonitoringStatus, { view: { ...baseView, monitoring: { ...baseView.monitoring, status: 'STOPPED', started_at: date, stopped_at: date, stop_reason: reason, events_received: 125 } }, fetchedAt: date })
    assert.ok(html.includes(label))
    assert.match(html, /125/)
    assert.match(html, /Monitoring started/)
    assert.match(html, /Monitoring stopped/)
  }
})

test('timeline distinguishes event types, shows hostname, browser timestamp, sequence and tab zero', () => {
  const html = render(ActivityTimeline, { events: [event, { ...event, event_id: 'evt_navigation', event_type: 'WEBSITE_NAVIGATION', tab_id: null }] })
  for (const expected of ['Tab switch', 'TAB_SWITCH', 'Website navigation', 'WEBSITE_NAVIGATION', 'docs.python.org', 'Sequence 1 / 10', 'Tab 0']) assert.ok(html.includes(expected), expected)
  assert.match(html, new RegExp(`datetime="${date}"`, 'i'))
  assert.doesNotMatch(html, /Tab null/)
})

test('timeline handles empty history, non-web tabs and malformed hostnames without disclosing URLs', () => {
  assert.match(render(ActivityTimeline, { events: [] }), /No browser events recorded.*does not establish/)
  for (const hostname of [null, '', 'https://example.com/private?secret=1', 'example.com/private', 'chrome://newtab', 'user@example.com']) {
    const html = render(ActivityTimeline, { events: [{ ...event, hostname }] })
    assert.match(html, /Hostname unavailable/)
    assert.doesNotMatch(html, /secret|private|chrome:\/\/|user@/)
  }
  assert.equal(monitoring.displayHostname('localhost'), 'localhost')
  assert.equal(monitoring.displayHostname('xn--bcher-kva.example'), 'xn--bcher-kva.example')
})

test('overlapping pages are deduplicated and ordered by client then server sequence, not timestamps', () => {
  const first = { ...event, event_id: 'evt_first', client_sequence: 0, occurred_at: '2026-11-25T11:00:00Z' }
  const tied = { ...event, event_id: 'evt_tied', server_sequence: 9 }
  const result = monitoring.mergeEvents([event], [first, tied, event])
  assert.deepEqual(result.map(row => row.event_id), ['evt_first', 'evt_tied', 'evt_test'])
})

test('monitoring and paginated event requests use only the employer header and explicit limit/offset', async t => {
  const paths = ['/api/sessions/sess%2Ftest/monitoring', '/api/sessions/sess%2Ftest/events?limit=50&offset=0', '/api/sessions/sess%2Ftest/events?limit=50&offset=50']
  const pages = [baseView, { session_id: 'sess_test', total_events: 51, limit: 50, offset: 0, events: Array.from({ length: 50 }, (_, i) => ({ ...event, event_id: `evt_${i}`, client_sequence: i })) }, { session_id: 'sess_test', total_events: 51, limit: 50, offset: 50, events: [{ ...event, event_id: 'evt_50', client_sequence: 50 }] }]
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `http://127.0.0.1:8000${paths.shift()}`)
    assert.equal(options.method, 'GET')
    assert.equal(options.headers['X-Vouch-Dev-Employer'], 'test-employer-001')
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.body, undefined)
    assert.equal(options.cache, 'no-store')
    return Response.json(pages.shift())
  })
  assert.deepEqual(await monitoring.getMonitoring('sess/test'), baseView)
  const first = await monitoring.getEvents('sess/test')
  assert.equal(first.events.length, 50)
  assert.equal(first.total_events, 51)
  const next = await monitoring.getEvents('sess/test', first.offset + first.events.length)
  assert.equal(monitoring.mergeEvents(first.events, next.events).length, 51)
  assert.equal(paths.length, 0)
})

test('monitoring API handles unavailable backend, unauthorized employer, missing session and malformed responses', async t => {
  const fetch = t.mock.method(globalThis, 'fetch')
  for (const [status, code, message] of [[401, 'DEV_EMPLOYER_INVALID', /VITE_DEV_EMPLOYER_KEY/], [404, 'SESSION_NOT_FOUND', /could not be found/], [404, 'NOT_FOUND', /VOUCH_ENABLE_DEV_ENDPOINTS/], [500, 'INTERNAL_ERROR', /try again later/]]) {
    fetch.mock.mockImplementation(async () => Response.json({ error: { code, message: 'private response' } }, { status }))
    await assert.rejects(monitoring.getMonitoring('sess_test'), message)
    await assert.rejects(monitoring.getEvents('sess_test'), message)
  }
  globalThis.window = { location: { origin: 'http://localhost:5173' } }
  t.after(() => { delete globalThis.window })
  fetch.mock.mockImplementation(async () => { throw new TypeError('offline') })
  await assert.rejects(monitoring.getMonitoring('sess_test'), /Could not reach the backend/)
  fetch.mock.mockImplementation(async () => new Response('bad json'))
  await assert.rejects(monitoring.getEvents('sess_test'), /invalid JSON/)
})

test('a failed pagination request can be retried at the same offset', async t => {
  let attempts = 0
  t.mock.method(globalThis, 'fetch', async url => {
    assert.match(url, /limit=50&offset=50$/)
    if (++attempts === 1) return new Response('unavailable', { status: 503 })
    return Response.json({ session_id: 'sess_test', total_events: 51, limit: 50, offset: 50, events: [event] })
  })
  await assert.rejects(monitoring.getEvents('sess_test', 50), /HTTP 503/)
  assert.equal((await monitoring.getEvents('sess_test', 50)).events.length, 1)
})

test('existing dashboard and creation form still render', async () => {
  const { default: App } = await server.ssrLoadModule('/src/App.tsx')
  const { CreateInterviewForm } = await server.ssrLoadModule('/src/components/CreateInterviewForm.tsx')
  const html = render(App)
  for (const text of ['Interview Sessions', 'Create Interview', 'Loading sessions', 'Test Backend Connection', 'About Vouch']) assert.ok(html.includes(text), text)
  const form = render(CreateInterviewForm, { onCreated() {}, onCancel() {} })
  for (const text of ['Interview title', 'Candidate name', 'AI-use policy', 'Allowed domains', 'Restricted domains']) assert.ok(form.includes(text), text)
})
