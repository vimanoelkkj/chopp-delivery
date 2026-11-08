import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  CMS_CODES,
  CMS_STAGES,
  captureTail,
  createTailSanitizer,
  sanitizeEnvelope,
} from './pages-tail-sanitizer.mjs'

// Every sensitive value below is fictional (RFC 5737/3849 documentation addresses).
const SENSITIVE = [
  '192.0.2.55',
  '2001:db8::7',
  'FAKE_SESSION_COOKIE',
  'FAKE_JWT_TOKEN',
  'operator@example.invalid',
  'private-path-secret',
  'FAKE_R2_KEY',
  'SELECT secret FROM fake',
  'FAKE_RAY',
]

const envelope = (overrides = {}) => ({
  outcome: 'ok',
  scriptName: 'pages-worker--fake-production',
  exceptions: [],
  logs: [],
  eventTimestamp: 1793938058001,
  event: {
    request: {
      url: 'https://example.invalid/api/private-path-secret?token=FAKE_JWT_TOKEN',
      method: 'GET',
      headers: {
        cookie: 'sid=FAKE_SESSION_COOKIE',
        'cf-access-jwt-assertion': 'FAKE_JWT_TOKEN',
        'cf-access-authenticated-user-email': 'operator@example.invalid',
        'cf-connecting-ip': '2001:db8::7',
        'x-real-ip': '192.0.2.55',
        'cf-ray': 'FAKE_RAY',
      },
      cf: { city: 'Nowhere', note: '} {"tricky": "brace' },
    },
    response: { status: 404 },
  },
  ...overrides,
})

const cmsLog = (event, fields) => ({
  level: 'error',
  message: [event, fields],
  timestamp: 1793938058002,
})
const fields = (overrides = {}) => ({
  source: 'r2',
  stage: 'r2.put',
  code: 'MEDIA_OBJECT_CONFLICT',
  profile: 'hero',
  elapsedMs: 120,
  stageMs: 30,
  ...overrides,
})

function run(text, chunkSize = text.length) {
  const out = []
  const sanitizer = createTailSanitizer((event) => out.push(event))
  for (let at = 0; at < text.length; at += chunkSize) sanitizer.push(text.slice(at, at + chunkSize))
  sanitizer.end()
  return out
}
const assertClean = (value) => {
  const serialized = JSON.stringify(value)
  for (const secret of SENSITIVE) assert.equal(serialized.includes(secret), false, secret)
}

test('accepts a complete multi-line envelope and keeps only the invocation allowlist', () => {
  const pretty = JSON.stringify(envelope(), null, 2)
  assert.ok(pretty.split('\n').length > 20)
  const expected = [
    {
      kind: 'invocation',
      timestamp: '2026-11-06T04:07:38.001Z',
      method: 'GET',
      status: 404,
      outcome: 'ok',
      exceptions: false,
    },
  ]
  assert.deepEqual(run(pretty), expected)
  assertClean(run(pretty))
})

test('is independent of chunk boundaries, braces inside strings and concatenated envelopes', () => {
  const text = `${JSON.stringify(envelope(), null, 2)}\n${JSON.stringify(envelope({ outcome: 'exception', exceptions: [{ message: 'SELECT secret FROM fake' }] }), null, 4)}`
  const whole = run(text)
  assert.equal(whole.length, 2)
  for (const size of [1, 3, 7, 64]) assert.deepEqual(run(text, size), whole)
  assert.deepEqual(
    whole.map((event) => [event.outcome, event.exceptions]),
    [
      ['ok', false],
      ['exception', true],
    ],
  )
  assertClean(whole)
})

test('normalizes unexpected invocation values instead of echoing them', () => {
  const [event] = sanitizeEnvelope(
    JSON.stringify(
      envelope({
        outcome: 'FAKE_JWT_TOKEN',
        eventTimestamp: 'FAKE_RAY',
        event: { request: { method: 'FAKE_JWT_TOKEN' }, response: { status: 'FAKE_RAY' } },
      }),
    ),
  )
  assert.deepEqual(event, {
    kind: 'invocation',
    timestamp: null,
    method: 'OTHER',
    status: null,
    outcome: 'other',
    exceptions: false,
  })
  assertClean(event)
})

test('keeps only the instrumented fields of the three CMS_MEDIA events', () => {
  const logs = [
    cmsLog('CMS_MEDIA_FAILURE', fields()),
    cmsLog(
      'CMS_MEDIA_RECOVERY_REQUIRED',
      fields({ source: 'd1', stage: 'd1.job_check', code: 'D1_CONTENTION', profile: null }),
    ),
    cmsLog(
      'CMS_MEDIA_INTAKE_RECOVERY_REQUIRED',
      fields({
        // Extra fields a faulty handler might add must be dropped, not forwarded.
        key: 'FAKE_R2_KEY',
        sql: 'SELECT secret FROM fake',
        cookie: 'FAKE_SESSION_COOKIE',
      }),
    ),
    cmsLog('SOME_OTHER_LOG', { message: 'FAKE_SESSION_COOKIE' }),
    { level: 'log', message: ['plain text with FAKE_JWT_TOKEN'] },
  ]
  const events = run(JSON.stringify(envelope({ logs }), null, 2))
  assert.deepEqual(
    events.map((event) => event.kind),
    ['invocation', 'cms_media', 'cms_media', 'cms_media'],
  )
  assert.deepEqual(events[1], {
    kind: 'cms_media',
    event: 'CMS_MEDIA_FAILURE',
    source: 'r2',
    stage: 'r2.put',
    code: 'MEDIA_OBJECT_CONFLICT',
    profile: 'hero',
    elapsedMs: 120,
    stageMs: 30,
  })
  assert.deepEqual(Object.keys(events[3]), [
    'kind',
    'event',
    'source',
    'stage',
    'code',
    'profile',
    'elapsedMs',
    'stageMs',
  ])
  assertClean(events)
})

test('drops a CMS_MEDIA event with any out-of-contract field and flags it without content', () => {
  for (const bad of [
    { stage: 'cms/derived/FAKE_R2_KEY' },
    { code: 'FAKE_SESSION_COOKIE value' },
    { source: 'SELECT secret FROM fake' },
    { profile: 'FAKE_JWT_TOKEN' },
    { elapsedMs: -1 },
    { stageMs: 1.5 },
    { elapsedMs: '12' },
  ]) {
    const events = run(
      JSON.stringify(envelope({ logs: [cmsLog('CMS_MEDIA_FAILURE', fields(bad))] })),
    )
    assert.deepEqual(events[1], { kind: 'cms_media_invalid', event: 'CMS_MEDIA_FAILURE' })
    assertClean(events)
  }
})

test('invalid, unknown, oversized, truncated and non-JSON input is discarded and flagged', () => {
  const secretNoise = 'FAKE_JWT_TOKEN 192.0.2.55'
  const cases = [
    [`{"outcome": "ok", "x": ${secretNoise}}`, 'malformed-json'],
    [JSON.stringify({ outcome: 'ok', note: secretNoise }), 'unknown-format'],
    [JSON.stringify({ event: {}, outcome: 7, note: secretNoise }), 'unknown-format'],
    [`${JSON.stringify(envelope(), null, 2).slice(0, 200)}`, 'truncated-envelope'],
    [`banner ${secretNoise}`, 'non-json-output'],
    [
      `{"outcome":"ok","event":{},"pad":"${'x'.repeat(1_100_000)}","leak":"FAKE_JWT_TOKEN"}`,
      'envelope-too-large',
    ],
  ]
  for (const [input, reason] of cases) {
    const events = run(input)
    assert.deepEqual(events, [{ kind: 'invalid', reason }], reason)
    assertClean(events)
  }
})

test('recovers after a bad envelope and still sanitizes the next valid one', () => {
  const events = run(`{broken FAKE_JWT_TOKEN}\n${JSON.stringify(envelope())}`)
  assert.deepEqual(
    events.map((event) => event.kind),
    ['invalid', 'invocation'],
  )
  assertClean(events)
})

// A synthetic child stands in for wrangler: it prints a pretty multi-line envelope with
// fictional sensitive data, writes secrets to stderr, then hangs until it is terminated.
const childScript = (body) => `
${body}
setInterval(() => {}, 1000)`
const printer = (value) =>
  `process.stderr.write('stderr FAKE_JWT_TOKEN 192.0.2.55\\n');
   const parts = ${JSON.stringify(JSON.stringify(value, null, 2))}.split('\\n');
   let at = 0; const tick = () => { if (at < parts.length) { process.stdout.write(parts[at++] + '\\n'); setTimeout(tick, 2) } }; tick();`

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const gone = async (pid) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}
const tmpEntries = () => new Set(readdirSync(tmpdir()))

test('captureTail stops at the event limit, kills the child and leaves no temp files', async () => {
  const before = tmpEntries()
  const lines = []
  const result = await captureTail({
    command: process.execPath,
    args: ['-e', childScript(printer(envelope({ logs: [cmsLog('CMS_MEDIA_FAILURE', fields())] })))],
    maxEvents: 1,
    timeoutMs: 20_000,
    write: (line) => lines.push(line),
  })
  assert.equal(result.reason, 'max-events')
  assert.equal(result.cleanup, 'forced')
  assert.equal(result.events, 1)
  assert.equal(result.invalid, 0)
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).kind),
    ['invocation', 'cms_media'],
  )
  assertClean(lines)
  assert.ok(await gone(result.pid), 'child must be terminated')
  assert.deepEqual(
    [...tmpEntries()].filter((name) => !before.has(name)),
    [],
  )
})

test('captureTail times out silently, terminates the child process tree and reports no content', async () => {
  const lines = []
  const started = Date.now()
  const result = await captureTail({
    command: process.execPath,
    args: ['-e', childScript('')],
    maxEvents: 1,
    timeoutMs: 400,
    write: (line) => lines.push(line),
  })
  assert.equal(result.reason, 'timeout')
  assert.ok(Date.now() - started < 10_000)
  assert.ok(await gone(result.pid), 'child must be terminated')
  assert.deepEqual(lines, [])
  assertClean(lines)
})

test('captureTail kills the child on abort and reports spawn failures without leaking', async () => {
  const controller = new AbortController()
  const lines = []
  const pending = captureTail({
    command: process.execPath,
    args: ['-e', childScript('')],
    timeoutMs: 20_000,
    write: (line) => lines.push(line),
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 200)
  const aborted = await pending
  assert.equal(aborted.reason, 'aborted')
  assert.ok(await gone(aborted.pid), 'child must be terminated')
  const missing = await captureTail({
    command: 'definitely-not-an-installed-command-FAKE_JWT_TOKEN',
    timeoutMs: 5_000,
    write: (line) => lines.push(line),
  })
  assert.equal(missing.reason, 'spawn-error')
  assertClean(lines)
})

test('allowlists match the instrumentation in media-library.ts (drift guard)', () => {
  const source = readFileSync(new URL('../server/cms/media-library.ts', import.meta.url), 'utf8')
  const stages = new Set([...source.matchAll(/\bat\('([a-z0-9_.]+)'\)/g)].map((m) => m[1]))
  stages.add('handler.start')
  assert.ok(stages.size >= 25)
  assert.deepEqual(
    [...stages].filter((stage) => !CMS_STAGES.has(stage)),
    [],
  )
  const marker = `${String.fromCharCode(92)}b(MEDIA_LEASE|`
  const open = source.indexOf(marker) + 3
  assert.ok(open > 2, 'classification regex not found')
  const alternation = [null, source.slice(open, source.indexOf(')', open))]
  assert.ok(alternation, 'classification regex not found')
  const codes = new Set(alternation[1].split('|'))
  for (const match of source.matchAll(/code = '([A-Z0-9_]+)'/g)) codes.add(match[1])
  assert.ok(codes.has('MEDIA_QUOTA') && codes.has('D1_CONTENTION'))
  assert.deepEqual(
    [...codes].filter((code) => !CMS_CODES.has(code)),
    [],
  )
})

test('rejects well-formed but unlisted or inconsistent stage/code/source values', () => {
  for (const bad of [
    { stage: 'r2.FAKE_R2_KEY' },
    { stage: 'r2.unknown_stage' },
    { code: 'MEDIA_SOMETHING_NEW' },
    { code: 'FAKE_SESSION_COOKIE' },
    { source: 'd1' }, // stage r2.put belongs to source r2
  ]) {
    const events = run(
      JSON.stringify(envelope({ logs: [cmsLog('CMS_MEDIA_FAILURE', fields(bad))] })),
    )
    assert.deepEqual(events[1], { kind: 'cms_media_invalid', event: 'CMS_MEDIA_FAILURE' })
    assertClean(events)
  }
})

test('expectPath matches in memory and never emits the path; others are counted as ignored', () => {
  const other = envelope()
  other.event.request.url = 'https://example.invalid/favicon.ico'
  const text = `${JSON.stringify(other)}${JSON.stringify(envelope())}`
  const out = []
  const sanitizer = createTailSanitizer((event) => out.push(event), {
    expectPath: '/api/private-path-secret',
  })
  sanitizer.push(text)
  assert.deepEqual(
    out.map((event) => event.kind),
    ['ignored', 'invocation'],
  )
  assert.equal(JSON.stringify(out).includes('private-path-secret'), false)
  assert.equal(JSON.stringify(out).includes('favicon'), false)
})

test('expectMethod and expectPath are matched in memory and combined; neither is ever emitted', () => {
  const make = (method, path) => {
    const value = envelope()
    value.event.request.method = method
    value.event.request.url = `https://example.invalid${path}`
    return JSON.stringify(value)
  }
  const text = [
    make('GET', '/api/private-path-secret'),
    make('POST', '/favicon.ico'),
    make('POST', '/api/private-path-secret'),
  ].join('')
  const run = (options) => {
    const out = []
    const sanitizer = createTailSanitizer((event) => out.push(event), options)
    sanitizer.push(text)
    return out
  }
  const both = run({ expectPath: '/api/private-path-secret', expectMethod: 'POST' })
  assert.deepEqual(
    both.map((event) => event.kind),
    ['ignored', 'ignored', 'invocation'],
  )
  assert.equal(both[2].method, 'POST')
  assert.equal(JSON.stringify(both).includes('private-path-secret'), false)
  const methodOnly = run({ expectMethod: 'POST' })
  assert.deepEqual(
    methodOnly.map((event) => event.kind),
    ['ignored', 'invocation', 'invocation'],
  )
  const pathOnly = run({ expectPath: '/api/private-path-secret' })
  assert.deepEqual(
    pathOnly.map((event) => event.kind),
    ['invocation', 'ignored', 'invocation'],
  )
  assert.deepEqual(
    run({}).map((event) => event.kind),
    ['invocation', 'invocation', 'invocation'],
  )
  assert.deepEqual(
    run({ expectMethod: 'PATCH' }).map((event) => event.kind),
    ['ignored', 'ignored', 'ignored'],
  )
})

test('captureTail with a limit of one stops at the matching invocation and halts later envelopes', async () => {
  const lines = []
  const unrelated = envelope()
  unrelated.event.request.url = 'https://example.invalid/other'
  const later = envelope({ outcome: 'exception' })
  const result = await captureTail({
    command: process.execPath,
    args: [
      '-e',
      childScript(
        `process.stdout.write(${JSON.stringify(`${JSON.stringify(unrelated, null, 2)}
${JSON.stringify(envelope({ logs: [cmsLog('CMS_MEDIA_FAILURE', fields())] }), null, 2)}
${JSON.stringify(later)}
`)})`,
      ),
    ],
    expectPath: '/api/private-path-secret',
    maxEvents: 1,
    timeoutMs: 20_000,
    write: (line) => lines.push(line),
  })
  assert.equal(result.reason, 'max-events')
  assert.equal(result.ignored, 1)
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).kind),
    ['ignored', 'invocation', 'cms_media'],
  )
  assert.ok(await gone(result.pid))
  assertClean(lines)
})

test('captureTail interrupts on unexpected output without exposing it and kills the child', async () => {
  for (const output of [
    'FAKE_JWT_TOKEN 192.0.2.55 unexpected banner',
    '{"outcome":"ok","note":"FAKE_JWT_TOKEN"}',
    `{"outcome":"ok","event":{},"logs":[{"message":["CMS_MEDIA_FAILURE",{"stage":"r2.FAKE_R2_KEY"}]}]}`,
  ]) {
    const lines = []
    const result = await captureTail({
      command: process.execPath,
      args: [
        '-e',
        childScript(
          `process.stdout.write(${JSON.stringify(`${output}
{`)})`,
        ),
      ],
      maxEvents: 5,
      timeoutMs: 20_000,
      write: (line) => lines.push(line),
    })
    assert.equal(result.reason, 'invalid-output')
    assert.ok(result.invalid >= 1)
    assert.ok(await gone(result.pid))
    assertClean(lines)
    assert.ok(lines.every((line) => /"kind":"(invalid|cms_media_invalid|invocation)"/.test(line)))
  }
})

test('captureTail reports cleanup "exited" when the child finishes by itself and "forced" otherwise', async () => {
  const lines = []
  const natural = await captureTail({
    command: process.execPath,
    args: ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify(envelope(), null, 2))})`],
    maxEvents: 5,
    timeoutMs: 20_000,
    write: (line) => lines.push(line),
  })
  assert.equal(natural.reason, 'child-exit')
  assert.equal(natural.cleanup, 'exited')
  assert.equal(natural.events, 1)
  const hung = await captureTail({
    command: process.execPath,
    args: ['-e', childScript('')],
    timeoutMs: 300,
    write: (line) => lines.push(line),
  })
  assert.equal(hung.reason, 'timeout')
  assert.equal(hung.cleanup, 'forced')
  assert.ok(await gone(hung.pid))
  assertClean(lines)
})
