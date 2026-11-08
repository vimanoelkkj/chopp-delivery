import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Sanitizes `wrangler pages deployment tail --format json` output. Nothing from an input
// envelope is ever copied wholesale: every emitted object is built here from allowlisted,
// individually validated fields. Unknown or malformed input is dropped and only flagged.

export const MAX_ENVELOPE_CHARS = 1_048_576
export const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
const OUTCOMES = new Set([
  'ok',
  'exception',
  'exceededCpu',
  'exceededMemory',
  'canceled',
  'unknown',
  'scriptNotFound',
  'responseStreamDisconnected',
])
const CMS_EVENTS = new Set([
  'CMS_MEDIA_FAILURE',
  'CMS_MEDIA_RECOVERY_REQUIRED',
  'CMS_MEDIA_INTAKE_RECOVERY_REQUIRED',
])
const PROFILES = new Set(['hero', 'section'])
// Exact values emitted by report() in server/cms/media-library.ts. A drift test keeps the stage
// list in sync; anything else fails closed as `cms_media_invalid` instead of being forwarded.
export const CMS_STAGES = new Set([
  'handler.start',
  'handler.identity',
  'handler.replay',
  'd1.authorize',
  'd1.completed_check',
  'd1.deleting_media',
  'd1.expired_jobs',
  'd1.intake_check',
  'd1.intake_claim',
  'd1.intake_release',
  'd1.job_check',
  'd1.job_lookup',
  'd1.job_read',
  'd1.job_start',
  'd1.media_read',
  'd1.object_owner',
  'd1.ready_media',
  'd1.receipt',
  'd1.recovery_expiry',
  'd1.recovery_status',
  'input.derivative_inspect',
  'input.hash',
  'input.inspect',
  'input.read',
  'processor.transform',
  'r2.delete',
  'r2.list',
  'r2.put',
  'r2.verify_read',
  'verification.objects',
])
export const CMS_CODES = new Set([
  'UNCLASSIFIED',
  'MEDIA_LEASE',
  'MEDIA_BUSY',
  'MEDIA_OBJECT_CONFLICT',
  'MEDIA_CONFLICT',
  'MEDIA_DIVERGENCE_OR_LEASE',
  'MEDIA_PROCESSING_TIMEOUT',
  'MEDIA_TIMEOUT',
  'MEDIA_UNAUTHORIZED',
  'MEDIA_PRECONDITION',
  'MEDIA_OBJECT_INTEGRITY',
  'MEDIA_PROCESSOR',
  'MEDIA_INVALID',
  'MEDIA_BYTES',
  'MEDIA_QUOTA',
  'D1_CONTENTION',
  'D1_UNIQUE_CONSTRAINT',
  'MEDIA_INTAKE_LEASE',
  'MEDIA_JOB_LEASE',
  'MEDIA_INTAKE_BUSY',
  'MEDIA_JOB_RUNNING',
])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isCount = (value) => Number.isSafeInteger(value) && value >= 0

function timestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function invocation(envelope) {
  const request = isObject(envelope.event.request) ? envelope.event.request : {}
  const response = isObject(envelope.event.response) ? envelope.event.response : {}
  return {
    kind: 'invocation',
    timestamp: timestamp(envelope.eventTimestamp),
    method: METHODS.has(request.method) ? request.method : 'OTHER',
    status:
      Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? response.status
        : null,
    outcome: OUTCOMES.has(envelope.outcome) ? envelope.outcome : 'other',
    exceptions: Array.isArray(envelope.exceptions) && envelope.exceptions.length > 0,
  }
}

function cmsMediaEvents(envelope) {
  if (!Array.isArray(envelope.logs)) return []
  const events = []
  for (const log of envelope.logs) {
    const message = isObject(log) && Array.isArray(log.message) ? log.message : null
    if (!message || !CMS_EVENTS.has(message[0])) continue
    const fields = message[1]
    const valid =
      isObject(fields) &&
      CMS_STAGES.has(fields.stage) &&
      fields.source === fields.stage.split('.')[0] &&
      CMS_CODES.has(fields.code) &&
      (fields.profile === null || PROFILES.has(fields.profile)) &&
      isCount(fields.elapsedMs) &&
      isCount(fields.stageMs)
    events.push(
      valid
        ? {
            kind: 'cms_media',
            event: message[0],
            source: fields.source,
            stage: fields.stage,
            code: fields.code,
            profile: fields.profile,
            elapsedMs: fields.elapsedMs,
            stageMs: fields.stageMs,
          }
        : { kind: 'cms_media_invalid', event: message[0] },
    )
  }
  return events
}

function pathOf(envelope) {
  try {
    return new URL(envelope.event.request.url).pathname
  } catch {
    return null
  }
}

function methodOf(envelope) {
  const request = envelope.event.request
  return isObject(request) && typeof request.method === 'string' ? request.method : null
}

/**
 * `expectPath` and `expectMethod` are compared in memory only and are never emitted. When both are
 * given an invocation must match both; any other envelope is only counted as `ignored`.
 */
export function sanitizeEnvelope(text, { expectPath, expectMethod } = {}) {
  let envelope
  try {
    envelope = JSON.parse(text)
  } catch {
    return [{ kind: 'invalid', reason: 'malformed-json' }]
  }
  if (!isObject(envelope) || !isObject(envelope.event) || typeof envelope.outcome !== 'string')
    return [{ kind: 'invalid', reason: 'unknown-format' }]
  if (expectPath !== undefined && pathOf(envelope) !== expectPath) return [{ kind: 'ignored' }]
  if (expectMethod !== undefined && methodOf(envelope) !== expectMethod)
    return [{ kind: 'ignored' }]
  return [invocation(envelope), ...cmsMediaEvents(envelope)]
}

/** Streaming extractor: tolerates multi-line objects, arbitrary chunking and braces in strings. */
export function createTailSanitizer(emit, { expectPath, expectMethod, halted = () => false } = {}) {
  let depth = 0
  let inString = false
  let escaped = false
  let size = 0
  let overflow = false
  let noise = false
  let parts = []

  const flushNoise = () => {
    if (!noise) return
    noise = false
    emit({ kind: 'invalid', reason: 'non-json-output' })
  }
  const reset = () => {
    depth = 0
    inString = false
    escaped = false
    size = 0
    overflow = false
    parts = []
  }
  const finish = () => {
    const text = parts.join('')
    const tooLarge = overflow
    reset()
    if (tooLarge) emit({ kind: 'invalid', reason: 'envelope-too-large' })
    else for (const event of sanitizeEnvelope(text, { expectPath, expectMethod })) emit(event)
  }

  return {
    push(chunk) {
      for (const char of String(chunk)) {
        if (halted()) return
        if (depth === 0) {
          if (char === '{') {
            flushNoise()
            depth = 1
            size = 1
            parts = ['{']
          } else if (!/\s/.test(char)) noise = true
          continue
        }
        size += 1
        if (!overflow) {
          if (size > MAX_ENVELOPE_CHARS) {
            overflow = true
            parts = []
          } else parts.push(char)
        }
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') inString = false
        } else if (char === '"') inString = true
        else if (char === '{') depth += 1
        else if (char === '}') {
          depth -= 1
          if (depth === 0) finish()
        }
      }
    },
    end() {
      if (depth > 0) {
        reset()
        emit({ kind: 'invalid', reason: 'truncated-envelope' })
      }
      flushNoise()
    },
  }
}

/**
 * Returns 'exited' when the child had already finished on its own, else 'forced'. On Windows no
 * signal or taskkill without /F runs Node signal handlers (verified locally), so a forced kill
 * means the child's own cleanup (e.g. the remote tail DELETE) did NOT run.
 */
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return 'exited'
  try {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }
  return 'forced'
}

/**
 * Runs one capture child, sanitizes its stdout and always tears it down (limit, timeout, error
 * or caller abort). stderr is drained and discarded; no files are created.
 */
export function captureTail({
  command,
  args = [],
  env = process.env,
  timeoutMs = 60_000,
  maxEvents = 1,
  expectPath,
  expectMethod,
  abortOnInvalid = true,
  write,
  signal,
}) {
  return new Promise((resolve) => {
    let invalid = 0
    let count = 0
    let ignored = 0
    let done = false
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      shell: false,
    })
    const finish = (reason) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const cleanup = killTree(child)
      resolve({ reason, events: count, ignored, invalid, cleanup, pid: child.pid })
    }
    const sanitizer = createTailSanitizer(
      (event) => {
        const unexpected = event.kind === 'invalid' || event.kind === 'cms_media_invalid'
        if (unexpected) invalid += 1
        if (event.kind === 'invocation') count += 1
        if (event.kind === 'ignored') ignored += 1
        write(JSON.stringify(event))
        // Envelope siblings (CMS events) are still written; later envelopes are halted.
        if (unexpected && abortOnInvalid) finish('invalid-output')
        else if (count >= maxEvents) finish('max-events')
      },
      { expectPath, expectMethod, halted: () => done },
    )
    const onAbort = () => finish('aborted')
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (!done) sanitizer.push(chunk)
    })
    child.stderr.on('data', () => {})
    child.on('error', () => finish('spawn-error'))
    child.on('close', () => {
      if (done) return
      sanitizer.end()
      finish('child-exit')
    })
  })
}

async function main(argv) {
  const separator = argv.indexOf('--')
  const options = separator === -1 ? argv : argv.slice(0, separator)
  const command = separator === -1 ? [] : argv.slice(separator + 1)
  const number = (name, fallback) => {
    const at = options.indexOf(name)
    const value = at === -1 ? fallback : Number(options[at + 1])
    return Number.isSafeInteger(value) && value > 0 ? value : fallback
  }
  const text = (name) => {
    const at = options.indexOf(name)
    return at === -1 ? undefined : options[at + 1]
  }
  const write = (line) => process.stdout.write(`${line}\n`)
  const abort = new AbortController()
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => abort.abort())

  if (command.length === 0) {
    let invalid = 0
    const sanitizer = createTailSanitizer(
      (event) => {
        if (event.kind === 'invalid' || event.kind === 'cms_media_invalid') invalid += 1
        write(JSON.stringify(event))
      },
      { expectPath: text('--expect-path'), expectMethod: text('--expect-method') },
    )
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) sanitizer.push(chunk)
    sanitizer.end()
    return invalid > 0 ? 3 : 0
  }
  const result = await captureTail({
    command: command[0],
    args: command.slice(1),
    timeoutMs: number('--timeout-ms', 60_000),
    maxEvents: number('--max-events', 1),
    expectPath: text('--expect-path'),
    expectMethod: text('--expect-method'),
    write,
    signal: abort.signal,
  })
  write(JSON.stringify({ kind: 'capture-end', ...result }))
  return result.invalid > 0 || result.reason === 'spawn-error' ? 3 : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
