import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

// Exercise the actual TypeScript modules with Vite's environment handling.
// These are mocked-fetch tests, not live backend or browser integration tests.
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://127.0.0.1:8000'),
    'import.meta.env.VITE_DEV_EMPLOYER_KEY': JSON.stringify('test-employer-001'),
  },
})
const api = await server.ssrLoadModule('/src/api.ts')
const sessions = await server.ssrLoadModule('/src/sessions.ts')
after(() => server.close())

const session = {
  session_id: 'sess_test', title: 'Backend Engineer Interview', candidate_name: 'Jordan Lee',
  policy: { ai_usage: 'PARTIALLY_ALLOWED', allowed_domains: ['docs.python.org'], restricted_domains: ['chatgpt.com'] },
  status: 'CREATED', created_at: '2026-11-14T05:13:32Z', join_code_expires_at: '2026-11-17T05:13:32Z',
  joined_at: null, candidate: null,
}

test('domain input supports commas/newlines, normalization and deduplication', () => {
  assert.deepEqual(sessions.parseDomains('docs.python.org,\nWWW.GitHub.com github.com.\n'), ['docs.python.org', 'github.com'])
  assert.deepEqual(sessions.parseDomains('  '), [])
})

test('domain input rejects URLs, paths, ports, bad labels and excessive lists', () => {
  for (const input of ['https://chatgpt.com', 'chatgpt.com/path', 'chatgpt.com:443', '-bad.com', 'bad-.com', 'localhost', 'bad..com', 'a'.repeat(64) + '.com']) {
    assert.throws(() => sessions.parseDomains(input), /hostnames/)
  }
  assert.throws(() => sessions.parseDomains(Array.from({ length: 51 }, (_, i) => `host${i}.com`).join(',')), /50/)
})

test('creation posts the policy and employer header, returning the code separately', async t => {
  const input = { title: session.title, candidate_name: session.candidate_name, policy: session.policy }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/api/sessions')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['X-Vouch-Dev-Employer'], 'test-employer-001')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.equal(options.cache, 'no-store')
    assert.deepEqual(JSON.parse(options.body), input)
    return Response.json({ ...session, candidate_join_code: 'FAKE-TEST-CODE-ONLY' }, { status: 201 })
  })
  const result = await sessions.createSession(input)
  assert.equal(result.joinCode, 'FAKE-TEST-CODE-ONLY')
  assert.deepEqual(result.session, session)
  assert.equal('candidate_join_code' in result.session, false)
})

test('list supports empty and populated responses; details supports a joined candidate', async t => {
  const joined = { ...session, status: 'JOINED', joined_at: '2026-11-14T06:00:00Z', candidate: { candidate_id: 'cand_test', name: 'Jordan', joined_at: '2026-11-14T06:00:00Z' } }
  const responses = [{ total_sessions: 0, sessions: [] }, { total_sessions: 1, sessions: [session] }, joined]
  const paths = ['/api/sessions', '/api/sessions', '/api/sessions/sess_test']
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `http://127.0.0.1:8000${paths.shift()}`)
    assert.equal(options.method, 'GET')
    assert.equal(options.headers['X-Vouch-Dev-Employer'], 'test-employer-001')
    assert.equal(options.body, undefined)
    return Response.json(responses.shift())
  })
  assert.deepEqual(await sessions.listSessions(), { total_sessions: 0, sessions: [] })
  assert.deepEqual(await sessions.listSessions(), { total_sessions: 1, sessions: [session] })
  assert.deepEqual(await sessions.getSession('sess_test'), joined)
})

for (const [status, code, expected] of [
  [401, 'DEV_EMPLOYER_REQUIRED', /VITE_DEV_EMPLOYER_KEY/],
  [401, 'DEV_EMPLOYER_INVALID', /1–64/],
  [404, 'SESSION_NOT_FOUND', /could not be found/],
  [404, 'NOT_FOUND', /VOUCH_ENABLE_DEV_ENDPOINTS=true/],
  [422, 'VALIDATION_ERROR', /hostnames/],
  [403, 'FORBIDDEN', /same machine/],
  [500, 'INTERNAL_ERROR', /try again later/],
]) {
  test(`structured error ${status} ${code} produces safe, helpful feedback`, async t => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: 'sensitive submitted value', details: ['sensitive value'] } }, { status }))
    await assert.rejects(sessions.listSessions(), error => {
      assert.equal(error.status, status)
      assert.equal(error.code, code)
      assert.match(error.message, expected)
      assert.doesNotMatch(error.message, /sensitive/)
      return true
    })
  })
}

test('health check still uses /health without an employer header', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/health')
    assert.equal(options.headers['X-Vouch-Dev-Employer'], undefined)
    return Response.json({ status: 'healthy' })
  })
  await api.checkBackendHealth()
})

test('unhealthy backend and invalid JSON are handled', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'unhealthy' }))
  await assert.rejects(api.checkBackendHealth(), /not "healthy"/)
  fetch.mock.mockImplementation(async () => new Response('not json'))
  await assert.rejects(sessions.listSessions(), /invalid JSON/)
  fetch.mock.mockImplementation(async () => new Response('proxy failed', { status: 502 }))
  await assert.rejects(sessions.listSessions(), /HTTP 502/)
})

test('network failure produces recovery guidance', async t => {
  globalThis.window = { location: { origin: 'http://localhost:5173' } }
  t.after(() => { delete globalThis.window })
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(sessions.listSessions(), /Could not reach the backend.*CORS/)
})

test('requests time out after ten seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  const result = sessions.listSessions()
  const rejection = assert.rejects(result, /within 10 seconds/)
  t.mock.timers.tick(10000)
  await rejection
})

test('missing employer configuration blocks employer requests but keeps health available', async t => {
  const unconfigured = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://127.0.0.1:8000'),
      'import.meta.env.VITE_DEV_EMPLOYER_KEY': JSON.stringify(''),
    },
  })
  try {
    const unconfiguredApi = await unconfigured.ssrLoadModule('/src/api.ts')
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'healthy' }))
    await assert.rejects(unconfiguredApi.getEmployerJson('/api/sessions'), /VITE_DEV_EMPLOYER_KEY/)
    assert.equal(fetch.mock.callCount(), 0)
    await unconfiguredApi.checkBackendHealth()
    assert.equal(fetch.mock.callCount(), 1)
  } finally {
    await unconfigured.close()
  }
})
