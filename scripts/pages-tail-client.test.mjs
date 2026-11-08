import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runPagesTail, TOKEN_ENV } from './pages-tail-client.mjs'

// Everything below is fictional: no network, no real token, ids or addresses.
const TOKEN = 'FAKE_TOKEN_aaaaaaaaaaaaaaaaaaaaaaaa'
const SESSION = 'FAKE_SESSION_ID_123'
const SOCKET = 'wss://tail.example.invalid/FAKE_WS_SECRET'
const ACCOUNT = 'a'.repeat(32)
const DEPLOYMENT = '11111111-2222-3333-4444-555555555555'
const SENSITIVE = [
  TOKEN,
  SESSION,
  'FAKE_WS_SECRET',
  '192.0.2.55',
  'FAKE_COOKIE',
  'operator@example.invalid',
]
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/proj/deployments/${DEPLOYMENT}/tails`

const envelope = (path = '/api/canary', method = 'GET') => ({
  outcome: 'ok',
  exceptions: [],
  logs: [],
  eventTimestamp: 1793938058001,
  event: {
    request: {
      url: `https://example.invalid${path}?x=FAKE_COOKIE`,
      method,
      headers: { 'cf-connecting-ip': '192.0.2.55', email: 'operator@example.invalid' },
    },
    response: { status: 404 },
  },
})

const json = (status, body) => ({ status, json: async () => body })
const created = (overrides = {}) =>
  json(200, {
    success: true,
    result: { id: SESSION, url: SOCKET, expires_at: '2026-11-06T10:00:00Z', ...overrides },
  })

class FakeSocket extends EventTarget {
  static instances = []
  constructor(url, protocols) {
    super()
    this.url = url
    this.protocols = protocols
    this.sent = []
    this.closed = false
    FakeSocket.instances.push(this)
  }
  send(data) {
    if (FakeSocket.failSend) throw new Error(TOKEN)
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  open() {
    this.dispatchEvent(new Event('open'))
  }
  message(data) {
    this.dispatchEvent(Object.assign(new Event('message'), { data }))
  }
  drop() {
    this.dispatchEvent(new Event('close'))
  }
}

/** Builds a fetch fake; `del` decides the DELETE answer, `post` the create answer. */
function harness({
  post = async () => created(),
  del = async () => json(200, { success: true }),
} = {}) {
  FakeSocket.instances = []
  FakeSocket.failSend = false
  const calls = []
  const lines = []
  const state = { deleteSettled: false }
  const fetchImpl = async (url, init) => {
    calls.push({ method: init.method, url, auth: init.headers.Authorization })
    if (init.method === 'POST') return post(init)
    try {
      return await del(init)
    } finally {
      state.deleteSettled = true
    }
  }
  const run = (options = {}) =>
    runPagesTail({
      accountId: ACCOUNT,
      projectName: 'proj',
      deploymentId: DEPLOYMENT,
      env: { [TOKEN_ENV]: TOKEN },
      fetchImpl,
      WebSocketImpl: FakeSocket,
      write: (line) => lines.push(line),
      timeoutMs: 2_000,
      deleteTimeoutMs: 500,
      ...options,
    })
  return { calls, lines, run, state, socket: () => FakeSocket.instances[0] }
}
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
const assertClean = (...values) => {
  const serialized = JSON.stringify(values)
  for (const secret of SENSITIVE) assert.equal(serialized.includes(secret), false, secret)
}
const hangUntilAborted = (init) =>
  new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error(TOKEN))))

test('happy path: sanitized invocation, socket closed, DELETE awaited and confirmed', async () => {
  const h = harness({
    del: async () => {
      await tick(60)
      return json(200, { success: true })
    },
  })
  const pending = h.run({ maxEvents: 1 })
  await tick()
  const socket = h.socket()
  assert.equal(socket.url, SOCKET)
  assert.equal(socket.protocols, 'trace-v1')
  socket.open()
  assert.deepEqual(socket.sent, ['{"debug":false}'])
  socket.message(JSON.stringify(envelope(), null, 2))
  const result = await pending
  assert.equal(h.state.deleteSettled, true, 'result must wait for the DELETE')
  assert.equal(socket.closed, true)
  assert.deepEqual(
    h.calls.map((call) => [call.method, call.url, call.auth]),
    [
      ['POST', BASE, `Bearer ${TOKEN}`],
      ['DELETE', `${BASE}/${SESSION}`, `Bearer ${TOKEN}`],
    ],
  )
  assert.deepEqual(result, {
    reason: 'max-events',
    ready: true,
    events: 1,
    ignored: 0,
    invalid: 0,
    cleanup: 'confirmed',
    sessionKnown: true,
    deleteStatus: 200,
    expiresAt: '2026-11-06T10:00:00.000Z',
  })
  assert.deepEqual(
    h.lines.map((line) => JSON.parse(line).kind),
    ['ready', 'invocation'],
  )
  assertClean(h.lines, result)
})

test('DELETE failures never produce a confirmed cleanup', async () => {
  const cases = [
    ['http 500', async () => json(500, { success: false, errors: [{ message: TOKEN }] }), 500],
    ['http 404 (semantics not validated)', async () => json(404, { success: false }), 404],
    ['http 200 but success=false', async () => json(200, { success: false }), 200],
    [
      'http 200 with unreadable body',
      async () => ({
        status: 200,
        json: async () => {
          throw new Error(TOKEN)
        },
      }),
      200,
    ],
    [
      'network error',
      async () => {
        throw new Error(`boom ${TOKEN}`)
      },
      null,
    ],
    ['timeout', (init) => hangUntilAborted(init), null],
  ]
  for (const [label, del, status] of cases) {
    const h = harness({ del })
    const pending = h.run({ maxEvents: 1 })
    await tick()
    h.socket().open()
    h.socket().message(JSON.stringify(envelope()))
    const result = await pending
    assert.equal(result.cleanup, 'unconfirmed', label)
    assert.equal(result.deleteStatus, status, label)
    assert.equal(result.reason, 'max-events', label)
    assert.equal(
      h.calls.filter((call) => call.method === 'DELETE').length,
      1,
      `${label}: no 2nd DELETE`,
    )
    assertClean(h.lines, result)
  }
})

test('timeout, abort and connection loss still end the session with an awaited DELETE', async () => {
  for (const [label, trigger, reason] of [
    ['timeout', async () => {}, 'timeout'],
    ['abort', async (controller) => controller.abort(), 'aborted'],
    ['drop', async (_controller, socket) => socket.drop(), 'connection-lost'],
  ]) {
    const h = harness()
    const controller = new AbortController()
    const pending = h.run({
      timeoutMs: label === 'timeout' ? 150 : 5_000,
      signal: controller.signal,
    })
    await tick()
    await trigger(controller, h.socket())
    const result = await pending
    assert.equal(result.reason, reason, label)
    assert.equal(result.cleanup, 'confirmed', label)
    assert.equal(h.state.deleteSettled, true, label)
    assert.equal(h.socket().closed, true, label)
    assertClean(h.lines, result)
  }
})

test('an already-aborted signal and invalid output both clean up without leaking content', async () => {
  const early = harness()
  const controller = new AbortController()
  controller.abort()
  const stoppedEarly = await early.run({ signal: controller.signal })
  assert.equal(stoppedEarly.reason, 'aborted')
  // The POST was already in flight, so a session may exist whose id is unknown: never 'confirmed'.
  assert.deepEqual([stoppedEarly.cleanup, stoppedEarly.sessionKnown], ['unconfirmed', false])

  for (const payload of [
    '{broken FAKE_COOKIE',
    JSON.stringify({ outcome: 'ok', note: 'FAKE_COOKIE' }),
    'x'.repeat(1_100_000),
  ]) {
    const h = harness()
    const pending = h.run({ maxEvents: 5 })
    await tick()
    h.socket().open()
    h.socket().message(payload)
    const result = await pending
    assert.equal(result.reason, 'invalid-output')
    assert.ok(result.invalid >= 1)
    assert.equal(result.cleanup, 'confirmed')
    assertClean(h.lines, result)
  }
})

test('expectPath is matched in memory; unrelated invocations are only counted', async () => {
  const h = harness()
  const pending = h.run({ expectPath: '/api/canary', maxEvents: 1 })
  await tick()
  h.socket().open()
  h.socket().message(JSON.stringify(envelope('/favicon.ico')))
  h.socket().message(JSON.stringify(envelope('/api/canary')))
  const result = await pending
  assert.equal(result.ignored, 1)
  assert.equal(result.events, 1)
  assert.equal(h.lines.join('').includes('favicon'), false)
  assert.equal(h.lines.join('').includes('/api/canary'), false)
})

test('expectMethod + expectPath: other methods never consume max-events and nothing extra is emitted', async () => {
  const h = harness()
  const pending = h.run({ expectPath: '/api/admin/media', expectMethod: 'POST', maxEvents: 1 })
  await tick()
  h.socket().open()
  // Same path with GET (library listing), another path with POST, and a GET on another path.
  h.socket().message(JSON.stringify(envelope('/api/admin/media', 'GET')))
  h.socket().message(JSON.stringify(envelope('/api/admin/media', 'GET')))
  h.socket().message(JSON.stringify(envelope('/api/other', 'POST')))
  h.socket().message(JSON.stringify(envelope('/api/admin/other', 'GET')))
  await tick()
  assert.equal(h.socket().closed ?? false, false)
  h.socket().message(JSON.stringify(envelope('/api/admin/media', 'POST')))
  const result = await pending
  assert.equal(result.reason, 'max-events')
  assert.equal(result.events, 1)
  assert.equal(result.ignored, 4)
  assert.equal(result.invalid, 0)
  assert.equal(result.cleanup, 'confirmed')
  const emitted = h.lines.map((line) => JSON.parse(line))
  assert.deepEqual(
    emitted.map((event) => event.kind),
    ['ready', 'ignored', 'ignored', 'ignored', 'ignored', 'invocation'],
  )
  assert.equal(emitted.at(-1).method, 'POST')
  assert.equal(h.lines.join('').includes('/api/'), false)
  assertClean(...h.lines)
})

test('expectMethod alone filters by method; omitting it keeps the previous behaviour', async () => {
  const onlyMethod = harness()
  const a = onlyMethod.run({ expectMethod: 'POST', maxEvents: 1 })
  await tick()
  onlyMethod.socket().open()
  onlyMethod.socket().message(JSON.stringify(envelope('/x', 'GET')))
  onlyMethod.socket().message(JSON.stringify(envelope('/y', 'POST')))
  const resultA = await a
  assert.equal(resultA.ignored, 1)
  assert.equal(resultA.events, 1)

  const none = harness()
  const b = none.run({ maxEvents: 1 })
  await tick()
  none.socket().open()
  none.socket().message(JSON.stringify(envelope('/x', 'GET')))
  const resultB = await b
  assert.equal(resultB.ignored, 0)
  assert.equal(resultB.events, 1)
})

test('with no matching method the capture ends by timeout with confirmed cleanup, never by max-events', async () => {
  const h = harness()
  const pending = h.run({ expectMethod: 'POST', maxEvents: 1, timeoutMs: 150 })
  await tick()
  h.socket().open()
  h.socket().message(JSON.stringify(envelope('/api/admin/media', 'GET')))
  const result = await pending
  assert.equal(result.reason, 'timeout')
  assert.equal(result.events, 0)
  assert.equal(result.ignored, 1)
  assert.equal(result.cleanup, 'confirmed')
})

test('messages as ArrayBuffer/Blob are decoded; other types are flagged and stop the capture', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify(envelope())).buffer
  for (const data of [encoded, new Blob([JSON.stringify(envelope())])]) {
    const h = harness()
    const pending = h.run()
    await tick()
    h.socket().open()
    h.socket().message(data)
    assert.equal((await pending).events, 1)
  }
  const h = harness()
  const pending = h.run()
  await tick()
  h.socket().open()
  h.socket().message(42)
  assert.equal((await pending).reason, 'invalid-output')
})

test('create failures: 4xx needs no cleanup, 5xx/hang/malformed leave it unconfirmed', async () => {
  const rejected = harness({
    post: async () => json(403, { success: false, errors: [{ message: TOKEN }] }),
  })
  const r403 = await rejected.run()
  assert.deepEqual(
    [r403.reason, r403.cleanup, r403.sessionKnown, rejected.calls.length],
    ['create-failed', 'not-needed', false, 1],
  )
  assert.equal(FakeSocket.instances.length, 0)
  assertClean(r403)

  const serverError = await harness({ post: async () => json(500, {}) }).run()
  assert.deepEqual([serverError.reason, serverError.cleanup], ['create-failed', 'unconfirmed'])

  const lost = harness({ post: (init) => hangUntilAborted(init) })
  const timedOut = await lost.run({ timeoutMs: 100 })
  assert.deepEqual(
    [timedOut.reason, timedOut.cleanup, timedOut.sessionKnown],
    ['timeout', 'unconfirmed', false],
  )
  assert.equal(lost.calls.filter((call) => call.method === 'DELETE').length, 0)
  assertClean(timedOut)

  for (const body of [null, 'x', { result: null }, { result: { id: '../../evil', url: SOCKET } }]) {
    const h = harness({ post: async () => json(200, body) })
    const result = await h.run()
    assert.deepEqual(
      [result.reason, result.cleanup, result.sessionKnown],
      ['create-failed', 'unconfirmed', false],
    )
    assert.equal(
      h.calls.filter((call) => call.method === 'DELETE').length,
      0,
      'unsafe id never reaches a URL',
    )
    assert.equal(FakeSocket.instances.length, 0)
  }
})

test('a created session with an unusable socket URL is still deleted', async () => {
  for (const url of [
    'ws://tail.example.invalid/FAKE_WS_SECRET',
    'https://x.invalid',
    'not a url',
    'wss://user:pw@x.invalid/',
  ]) {
    const h = harness({ post: async () => created({ url }) })
    const result = await h.run()
    assert.equal(result.reason, 'create-failed')
    assert.equal(result.sessionKnown, true)
    assert.equal(result.cleanup, 'confirmed')
    assert.equal(h.calls.at(-1).method, 'DELETE')
    assert.equal(FakeSocket.instances.length, 0)
    assertClean(h.lines, result)
  }
})

test('configuration errors fail before any network use and never echo the token', async () => {
  const base = { accountId: ACCOUNT, projectName: 'proj', deploymentId: DEPLOYMENT }
  const cases = [
    [{ env: {} }, 'missing-token'],
    [{ env: { [TOKEN_ENV]: 'short token' } }, 'invalid-token-format'],
    [{ accountId: 'nope' }, 'invalid-account'],
    [{ projectName: '../x' }, 'invalid-project'],
    [{ deploymentId: 'zzz' }, 'invalid-deployment'],
    [{ expectMethod: 'post' }, 'invalid-method'],
    [{ expectMethod: 'POST /api' }, 'invalid-method'],
    [{ expectMethod: '' }, 'invalid-method'],
  ]
  for (const [override, code] of cases) {
    const h = harness()
    await assert.rejects(
      () => h.run({ ...base, env: { [TOKEN_ENV]: TOKEN }, ...override }),
      (error) => error.code === code && !String(error.message).includes(TOKEN),
    )
    assert.equal(h.calls.length, 0)
  }
})

test('CLI reads the token only from the environment and rejects token-like arguments', () => {
  const script = fileURLToPath(new URL('./pages-tail-client.mjs', import.meta.url))
  const run = (args, env) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    })
  const withFlag = run(['--token', TOKEN], { [TOKEN_ENV]: TOKEN })
  const badMethod = run(
    [
      '--account',
      ACCOUNT,
      '--project',
      'proj',
      '--deployment',
      DEPLOYMENT,
      '--expect-method',
      'post',
    ],
    { [TOKEN_ENV]: TOKEN },
  )
  assert.equal(badMethod.status, 2)
  assert.match(badMethod.stdout, /invalid-method/)
  assert.equal(`${badMethod.stdout}${badMethod.stderr}`.includes(TOKEN), false)
  assert.equal(withFlag.status, 2)
  assert.equal(`${withFlag.stdout}${withFlag.stderr}`.includes(TOKEN), false)
  assert.match(withFlag.stdout, /bad-arguments/)
  const missing = run(['--account', ACCOUNT, '--project', 'proj', '--deployment', DEPLOYMENT], {})
  assert.equal(missing.status, 2)
  assert.match(missing.stdout, /missing-token/)
})

test('ready is emitted exactly once, only after the socket is open, and before any event', async () => {
  const h = harness()
  const pending = h.run({ maxEvents: 1 })
  await tick()
  assert.deepEqual(h.lines, [], 'nothing before the socket opens')
  h.socket().open()
  h.socket().open()
  assert.deepEqual(h.lines, ['{"kind":"ready"}'])
  h.socket().message(JSON.stringify(envelope()))
  const result = await pending
  assert.deepEqual(
    h.lines.map((line) => JSON.parse(line).kind),
    ['ready', 'invocation'],
  )
  assert.equal(result.ready, true)
  assertClean(h.lines, result)
})

test('no ready when the capture fails or stops before the socket is usable', async () => {
  const scenarios = [
    ['socket closes before open', async (h) => h.socket().drop(), 'connection-lost'],
    [
      'socket error before open',
      async (h) => h.socket().dispatchEvent(new Event('error')),
      'connection-lost',
    ],
    ['timeout before open', async () => {}, 'timeout'],
    [
      'subscription send fails',
      async (h) => {
        FakeSocket.failSend = true
        h.socket().open()
      },
      'connection-lost',
    ],
  ]
  for (const [label, act, reason] of scenarios) {
    const h = harness()
    const pending = h.run({ timeoutMs: label === 'timeout before open' ? 150 : 5_000 })
    await tick()
    await act(h)
    const result = await pending
    assert.equal(result.reason, reason, label)
    assert.equal(result.ready, false, label)
    assert.equal(h.lines.includes('{"kind":"ready"}'), false, label)
    assert.equal(result.cleanup, 'confirmed', label)
    assert.equal(h.state.deleteSettled, true, label)
    assertClean(h.lines, result)
  }
  const aborted = harness()
  const controller = new AbortController()
  const pending = aborted.run({ signal: controller.signal })
  await tick()
  controller.abort()
  const result = await pending
  aborted.socket().open() // a late open after shutdown must not announce readiness
  assert.deepEqual([result.reason, result.ready, aborted.lines], ['aborted', false, []])
  for (const post of [async () => json(403, {}), async () => json(500, {})]) {
    const failed = harness({ post })
    assert.equal((await failed.run()).ready, false)
    assert.deepEqual(failed.lines, [])
  }
})

test('after ready, abort, drop, invalid output and a failing writer still end with DELETE awaited', async () => {
  const afterReady = [
    ['abort', (_h, c) => c.abort(), 'aborted'],
    ['drop', (h) => h.socket().drop(), 'connection-lost'],
    ['invalid output', (h) => h.socket().message('{broken'), 'invalid-output'],
  ]
  for (const [label, act, reason] of afterReady) {
    const h = harness()
    const controller = new AbortController()
    const pending = h.run({ maxEvents: 5, signal: controller.signal })
    await tick()
    h.socket().open()
    await act(h, controller)
    const result = await pending
    assert.equal(result.reason, reason, label)
    assert.equal(result.ready, true, label)
    assert.equal(h.lines[0], '{"kind":"ready"}', label)
    assert.equal(h.lines.filter((line) => line === '{"kind":"ready"}').length, 1, label)
    assert.equal(result.cleanup, 'confirmed', label)
    assert.equal(h.state.deleteSettled, true, label)
    assert.equal(h.socket().closed, true, label)
    assertClean(h.lines, result)
  }
  const h = harness()
  const pending = h.run({
    write: () => {
      throw new Error(TOKEN)
    },
  })
  await tick()
  h.socket().open()
  const result = await pending
  assert.deepEqual(
    [result.reason, result.ready, result.cleanup],
    ['output-failed', false, 'confirmed'],
  )
  assertClean(result)
})
