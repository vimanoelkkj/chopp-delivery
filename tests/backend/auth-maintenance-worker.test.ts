import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapOwner } from '../../server/auth/bootstrap'
import worker, { type MaintenanceEnv } from '../../server/auth/maintenance-worker'
import { recoverOwnerCredentials } from '../../server/auth/recovery'

// The D1/trigger core was validated in M3C; these tests exercise the scheduler boundary.
// No database, migration, remote resource or real credential is used here.
vi.mock('../../server/auth/bootstrap', () => ({ bootstrapOwner: vi.fn() }))
vi.mock('../../server/auth/recovery', () => ({ recoverOwnerCredentials: vi.fn() }))
const id = '12345678-1234-4123-8123-123456789012'
const password = 'Only a maintenance unit-test password'
const pepper = 'ab'.repeat(32)
const command = (action = 'recover', version = 1) => ({
  commandId: id,
  environment: 'homologation',
  action,
  username: 'owner',
  expectedAuthVersion: version,
  ...(action === 'recover' ? { ownerId: 'owner-test' } : {}),
})
const env = (): MaintenanceEnv => ({
  DELEGAS_DB: {} as D1Database,
  MAINTENANCE_ENVIRONMENT: 'homologation',
  MAINTENANCE_ENABLED: 'armed-v1',
  MAINTENANCE_COMMAND: JSON.stringify(command()),
  MAINTENANCE_PASSWORD: password,
  ADMIN_ORIGIN: 'https://homologation.example',
  ADMIN_PASSWORD_PEPPER: pepper,
})
const event = () => ({ noRetry: vi.fn() })

beforeEach(() => {
  vi.mocked(bootstrapOwner).mockResolvedValue(true)
  vi.mocked(recoverOwnerCredentials).mockResolvedValue(true)
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('M3D.1 scheduled-only maintenance boundary', () => {
  it('has no HTTP handler, route, preview URL or enabled schedule', () => {
    expect(Object.keys(worker)).toEqual(['scheduled'])
    const config = JSON.parse(readFileSync('config/cloudflare/maintenance-worker.jsonc', 'utf8'))
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    expect(config.routes).toEqual([])
    expect(config.triggers.crons).toEqual([])
    expect(config.vars.MAINTENANCE_ENABLED).toBe('disabled')
    expect(config.d1_databases).toBeUndefined()
    expect(config.r2_buckets).toBeUndefined()
    expect(config.services).toBeUndefined()
  })
  it('is inert unless explicitly armed and always disables scheduler retries', async () => {
    const tick = event()
    await worker.scheduled(tick, { ...env(), MAINTENANCE_ENABLED: undefined })
    expect(tick.noRetry).toHaveBeenCalledTimes(1)
    expect(recoverOwnerCredentials).not.toHaveBeenCalled()
    expect(bootstrapOwner).not.toHaveBeenCalled()
  })
  it.each([
    { MAINTENANCE_ENVIRONMENT: 'production' },
    { ADMIN_ORIGIN: 'http://homologation.example' },
    { ADMIN_ORIGIN: 'https://localhost' },
    { ADMIN_ORIGIN: 'https://homologation.example/path' },
    { ADMIN_ALLOW_INSECURE_LOCAL: '1' },
    { CMS_MEDIA_LOCAL: 'disposable-v1' },
    { MAINTENANCE_PASSWORD: undefined },
    { DELEGAS_DB: undefined },
    { ADMIN_PASSWORD_PEPPER: 'invalid' },
  ])('fails closed on invalid environment: %j', async (change) => {
    await worker.scheduled(event(), { ...env(), ...change })
    expect(recoverOwnerCredentials).not.toHaveBeenCalled()
    expect(bootstrapOwner).not.toHaveBeenCalled()
  })
  it.each([
    { environment: 'production' },
    { expectedAuthVersion: undefined },
    { expectedAuthVersion: 0 },
    { expectedAuthVersion: 1.5 },
    { commandId: 'not-a-command' },
    { extra: password },
  ])('rejects malformed or unversioned commands: %j', async (change) => {
    await worker.scheduled(event(), {
      ...env(),
      MAINTENANCE_COMMAND: JSON.stringify({ ...command(), ...change }),
    })
    expect(recoverOwnerCredentials).not.toHaveBeenCalled()
  })
  it('bootstrap requires expected empty state, calls the existing core and never replaces it with recovery', async () => {
    const settings = { ...env(), MAINTENANCE_COMMAND: JSON.stringify(command('bootstrap', 0)) }
    await worker.scheduled(event(), settings)
    expect(bootstrapOwner).toHaveBeenCalledExactlyOnceWith(
      settings.DELEGAS_DB,
      'owner',
      password,
      pepper,
      expect.any(Function),
    )
    expect(recoverOwnerCredentials).not.toHaveBeenCalled()
    vi.mocked(bootstrapOwner).mockClear()
    await worker.scheduled(event(), {
      ...settings,
      MAINTENANCE_COMMAND: JSON.stringify(command('bootstrap', 1)),
    })
    expect(bootstrapOwner).not.toHaveBeenCalled()
  })
  it('concurrent and stale invocations keep the exact expected version; no retry or version refresh', async () => {
    vi.mocked(recoverOwnerCredentials).mockResolvedValueOnce(true).mockResolvedValue(false)
    const settings = env(),
      initial = JSON.stringify(settings)
    await Promise.all([worker.scheduled(event(), settings), worker.scheduled(event(), settings)])
    expect(recoverOwnerCredentials).toHaveBeenCalledTimes(2)
    for (const call of vi.mocked(recoverOwnerCredentials).mock.calls)
      expect(call).toEqual([
        settings.DELEGAS_DB,
        { ownerId: 'owner-test', username: 'owner', expectedAuthVersion: 1, password },
        pepper,
      ])
    expect(JSON.stringify(settings)).toBe(initial)
    expect(bootstrapOwner).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledWith('ADMIN_MAINTENANCE', {
      commandId: id,
      result: 'NOT_APPLIED',
    })
  })
  it('reports the fixed bootstrap stage without serializing a crypto failure', async () => {
    vi.mocked(bootstrapOwner).mockImplementationOnce(
      async (_db, _username, _password, _pepper, onStage) => {
        onStage?.('password_hash')
        throw new Error(`${password} ${pepper} CRYPTO_INTERNAL_SENTINEL`)
      },
    )
    await worker.scheduled(event(), {
      ...env(),
      MAINTENANCE_COMMAND: JSON.stringify(command('bootstrap', 0)),
    })
    expect(bootstrapOwner).toHaveBeenCalledTimes(1)
    expect(recoverOwnerCredentials).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledExactlyOnceWith('ADMIN_MAINTENANCE', {
      commandId: id,
      result: 'UNCONFIRMED',
      stage: 'password_hash',
    })
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls)
    for (const secret of [password, pepper, 'CRYPTO_INTERNAL_SENTINEL'])
      expect(logs).not.toContain(secret)
  })

  it('lost responses/SQL errors remain unconfirmed and never leak secrets or trigger another command', async () => {
    vi.mocked(recoverOwnerCredentials).mockRejectedValue(
      new Error(`${password} ${pepper} database details`),
    )
    await worker.scheduled(event(), env())
    expect(recoverOwnerCredentials).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledExactlyOnceWith('ADMIN_MAINTENANCE', {
      commandId: id,
      result: 'UNCONFIRMED',
      stage: 'recovery',
    })
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logs).not.toContain(password)
    expect(logs).not.toContain(pepper)
    expect(logs).not.toContain('database details')
  })
})

describe('M3F private metadata inspection', () => {
  const inspect = { commandId: id, environment: 'homologation', action: 'inspect' }
  it('reads only owner metadata without a password or pepper, using the scheduled channel', async () => {
    const all = vi.fn(async () => ({
      success: true,
      results: [
        {
          id: 'owner-test',
          username: 'owner',
          active: 1,
          auth_version: 3,
          password_hash: 'must-not-leak',
          token_hash: 'must-not-leak',
        },
      ],
    }))
    const prepare = vi.fn(() => ({ all }))
    await worker.scheduled(event(), {
      ...env(),
      DELEGAS_DB: { prepare } as unknown as D1Database,
      MAINTENANCE_COMMAND: JSON.stringify(inspect),
      MAINTENANCE_PASSWORD: undefined,
      ADMIN_PASSWORD_PEPPER: undefined,
    })
    expect(prepare).toHaveBeenCalledExactlyOnceWith(
      'SELECT id, username, active, auth_version FROM admin_users LIMIT 2',
    )
    expect(all).toHaveBeenCalledTimes(1)
    expect(console.info).toHaveBeenCalledExactlyOnceWith('ADMIN_MAINTENANCE', {
      commandId: id,
      result: 'INSPECTED',
      owner: { id: 'owner-test', username: 'owner', active: true, authVersion: 3 },
    })
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('must-not-leak')
    expect(bootstrapOwner).not.toHaveBeenCalled()
    expect(recoverOwnerCredentials).not.toHaveBeenCalled()
  })
  it('reports an empty owner table conclusively, without bootstrapping', async () => {
    const prepare = vi.fn(() => ({ all: vi.fn(async () => ({ success: true, results: [] })) }))
    await worker.scheduled(event(), {
      ...env(),
      DELEGAS_DB: { prepare } as unknown as D1Database,
      MAINTENANCE_COMMAND: JSON.stringify(inspect),
    })
    expect(console.info).toHaveBeenCalledWith('ADMIN_MAINTENANCE', {
      commandId: id,
      result: 'INSPECTED',
      owner: null,
    })
    expect(bootstrapOwner).not.toHaveBeenCalled()
  })
  it.each([
    { results: [{ id: 'owner-test', username: 'owner', active: 1, auth_version: 0 }] },
    {
      results: [
        { id: 'owner-test', username: 'owner', active: 1, auth_version: 1 },
        { id: 'other', username: 'other', active: 1, auth_version: 1 },
      ],
    },
    { results: null },
    { results: [null] },
  ])(
    'refuses inconsistent metadata and never spreads a database row into logs',
    async ({ results }) => {
      const prepare = vi.fn(() => ({ all: vi.fn(async () => ({ success: true, results })) }))
      await worker.scheduled(event(), {
        ...env(),
        DELEGAS_DB: { prepare } as unknown as D1Database,
        MAINTENANCE_COMMAND: JSON.stringify(inspect),
      })
      expect(console.info).not.toHaveBeenCalled()
      expect(console.error).toHaveBeenCalledWith('ADMIN_MAINTENANCE', {
        commandId: id,
        result: 'UNCONFIRMED',
        stage: 'inspect_validate',
      })
    },
  )
  it('SQL failure cannot be mistaken for an empty account or disclose SQL/credentials', async () => {
    const prepare = vi.fn(() => ({
      all: vi.fn(async () => {
        throw new Error(`${password} SELECT password_hash`)
      }),
    }))
    await worker.scheduled(event(), {
      ...env(),
      DELEGAS_DB: { prepare } as unknown as D1Database,
      MAINTENANCE_COMMAND: JSON.stringify(inspect),
    })
    expect(console.info).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(password)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('password_hash')
    expect(recoverOwnerCredentials).not.toHaveBeenCalled()
  })
})
