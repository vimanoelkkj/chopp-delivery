import { fileURLToPath } from 'node:url'
import { MAX_ENVELOPE_CHARS, METHODS, sanitizeEnvelope } from './pages-tail-sanitizer.mjs'

// Minimal Pages tail client: POST creates the session, a WebSocket streams envelopes through the
// existing sanitizer, and an awaited DELETE in `finally` ends the remote session. The session id,
// the WebSocket URL and the token live only in memory. Nothing from the API or the tail (bodies,
// error messages, headers) is ever printed: results carry fixed codes and counters only.

export const TOKEN_ENV = 'CHOPP_TAIL_API_TOKEN'
const API = 'https://api.cloudflare.com/client/v4'
const ACCOUNT = /^[a-f0-9]{32}$/
const PROJECT = /^[a-z0-9][a-z0-9-]{0,57}$/
const DEPLOYMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SESSION_ID = /^[A-Za-z0-9_-]{6,128}$/
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/

export class TailClientError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function validateConfig({ env, accountId, projectName, deploymentId, expectMethod }) {
  const token = env[TOKEN_ENV]
  if (typeof token !== 'string' || token === '') throw new TailClientError('missing-token')
  if (!TOKEN.test(token)) throw new TailClientError('invalid-token-format')
  if (!ACCOUNT.test(accountId ?? '')) throw new TailClientError('invalid-account')
  if (!PROJECT.test(projectName ?? '')) throw new TailClientError('invalid-project')
  if (!DEPLOYMENT.test(deploymentId ?? '')) throw new TailClientError('invalid-deployment')
  if (expectMethod !== undefined && !METHODS.has(expectMethod))
    throw new TailClientError('invalid-method')
  return token
}

function sessionFrom(body) {
  const result = isObject(body) && isObject(body.result) ? body.result : null
  if (!result || typeof result.id !== 'string' || !SESSION_ID.test(result.id)) return null
  let socketUrl = null
  try {
    const url = new URL(result.url)
    if (url.protocol === 'wss:' && !url.username && !url.password) socketUrl = url.href
  } catch {
    // Invalid URL: the id is still kept so the session can be deleted.
  }
  const expires = Date.parse(result.expires_at)
  return {
    id: result.id,
    socketUrl,
    expiresAt: Number.isNaN(expires) ? null : new Date(expires).toISOString(),
  }
}

async function messageText(data) {
  if (typeof data === 'string') return data
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text()
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  return null
}

/**
 * Result: { reason, ready, events, ignored, invalid, cleanup, sessionKnown, deleteStatus, expiresAt }.
 * cleanup is 'confirmed' only when the DELETE answered 2xx with success=true; 'not-needed' only
 * when creation was rejected with a 4xx; every other outcome (including DELETE failures, an
 * unknown session after a lost create, and 404) is 'unconfirmed'. A second DELETE is never used.
 */
export async function runPagesTail({
  accountId,
  projectName,
  deploymentId,
  expectPath,
  expectMethod,
  maxEvents = 1,
  timeoutMs = 60_000,
  deleteTimeoutMs = 15_000,
  abortOnInvalid = true,
  write,
  signal,
  env = process.env,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
}) {
  const token = validateConfig({ env, accountId, projectName, deploymentId, expectMethod })
  const base = `${API}/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}/tails`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const result = {
    reason: 'internal-error',
    ready: false,
    events: 0,
    ignored: 0,
    invalid: 0,
    cleanup: 'unconfirmed',
    sessionKnown: false,
    deleteStatus: null,
    expiresAt: null,
  }
  const controller = new AbortController()
  let finished = false
  let settle
  const stopped = new Promise((resolve) => {
    settle = resolve
  })
  const stop = (reason) => {
    if (finished) return
    finished = true
    controller.abort()
    settle(reason)
  }
  const STOPPED = Symbol('stopped')
  const unlessStopped = (promise) => Promise.race([promise, stopped.then(() => STOPPED)])
  const timer = setTimeout(() => stop('timeout'), timeoutMs)
  const onAbort = () => stop('aborted')
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) stop('aborted')

  let session = null
  let creationRejected = false
  let socket = null
  try {
    try {
      const response = await unlessStopped(
        fetchImpl(base, { method: 'POST', headers, body: '{}', signal: controller.signal }),
      )
      if (response !== STOPPED) {
        if (response.status >= 400 && response.status < 500) creationRejected = true
        else if (response.status >= 200 && response.status < 300) {
          session = sessionFrom(await unlessStopped(response.json()))
        }
      }
    } catch {
      // Lost/failed create: the session may exist remotely but its id is unknown.
    }
    if (session) {
      result.sessionKnown = true
      result.expiresAt = session.expiresAt
    }
    if (!finished && !session?.socketUrl) stop('create-failed')

    if (!finished) {
      let chain = Promise.resolve()
      const handle = async (data) => {
        if (finished) return
        const text = await messageText(data)
        const events =
          text === null || text.length > MAX_ENVELOPE_CHARS
            ? [{ kind: 'invalid', reason: 'unreadable-message' }]
            : sanitizeEnvelope(text, { expectPath, expectMethod })
        let unexpected = false
        for (const event of events) {
          if (event.kind === 'invalid' || event.kind === 'cms_media_invalid') {
            result.invalid += 1
            unexpected = true
          } else if (event.kind === 'invocation') result.events += 1
          else if (event.kind === 'ignored') result.ignored += 1
          write(JSON.stringify(event))
        }
        if (unexpected && abortOnInvalid) stop('invalid-output')
        else if (result.events >= maxEvents) stop('max-events')
      }
      try {
        socket = new WebSocketImpl(session.socketUrl, 'trace-v1')
        socket.addEventListener('message', (event) => {
          chain = chain.then(() => handle(event.data)).catch(() => stop('invalid-output'))
        })
        const lost = () => stop('connection-lost')
        socket.addEventListener('close', lost)
        socket.addEventListener('error', lost)
        socket.addEventListener('open', () => {
          try {
            socket.send(JSON.stringify({ debug: false }))
          } catch {
            lost()
            return
          }
          // Ready = socket open and the subscription message accepted; emitted once, never after stop.
          if (finished || result.ready) return
          try {
            write(JSON.stringify({ kind: 'ready' }))
            result.ready = true
          } catch {
            stop('output-failed')
          }
        })
      } catch {
        stop('connection-lost')
      }
    }
    result.reason = await stopped
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    finished = true
    try {
      socket?.close()
    } catch {
      // The DELETE below is what ends the remote session.
    }
    if (session) {
      try {
        const response = await fetchImpl(`${base}/${session.id}`, {
          method: 'DELETE',
          headers,
          signal: AbortSignal.timeout(deleteTimeoutMs),
        })
        result.deleteStatus = response.status
        let accepted = false
        if (response.status >= 200 && response.status < 300) {
          try {
            accepted = (await response.json())?.success === true
          } catch {
            // Unreadable body: not confirmed.
          }
        }
        result.cleanup = accepted ? 'confirmed' : 'unconfirmed'
      } catch {
        result.cleanup = 'unconfirmed'
      }
    } else if (creationRejected) result.cleanup = 'not-needed'
  }
  return result
}

const FLAGS = new Set([
  '--account',
  '--project',
  '--deployment',
  '--expect-path',
  '--expect-method',
  '--max-events',
  '--timeout-ms',
])

async function main(argv) {
  const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
  const values = {}
  // Strict flag parsing; unknown flags (e.g. a token) are rejected without echoing them.
  for (let at = 0; at < argv.length; at += 2) {
    if (!FLAGS.has(argv[at]) || argv[at + 1] === undefined) {
      out({ kind: 'capture-end', reason: 'bad-arguments' })
      return 2
    }
    values[argv[at]] = argv[at + 1]
  }
  const number = (name, fallback) => {
    const value = values[name] === undefined ? fallback : Number(values[name])
    return Number.isSafeInteger(value) && value > 0 ? value : fallback
  }
  const abort = new AbortController()
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => abort.abort())
  try {
    const result = await runPagesTail({
      accountId: values['--account'],
      projectName: values['--project'],
      deploymentId: values['--deployment'],
      expectPath: values['--expect-path'],
      expectMethod: values['--expect-method'],
      maxEvents: number('--max-events', 1),
      timeoutMs: number('--timeout-ms', 60_000),
      write: (line) => process.stdout.write(`${line}\n`),
      signal: abort.signal,
    })
    out({ kind: 'capture-end', ...result })
    const cleaned = result.cleanup === 'confirmed' || result.cleanup === 'not-needed'
    return result.reason === 'max-events' && cleaned && result.invalid === 0 ? 0 : 3
  } catch (error) {
    out({ kind: 'capture-end', reason: error instanceof TailClientError ? error.code : 'error' })
    return 2
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
