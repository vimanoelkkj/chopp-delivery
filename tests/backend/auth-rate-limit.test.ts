import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleLogin, handleLogout, handleMe } from '../../server/auth/handlers'
import { LOGIN_BODY_TIMEOUT_MS, normalizeUsername, readLogin } from '../../server/auth/http'
import { keyedHash } from '../../server/auth/password'
import { LOGIN_WINDOW_MS } from '../../server/auth/rate-limit'
import { authFixture, authRequest, loginBody, seedOwner, TEST_PEPPER } from './auth-fixture'

const origin = 'https://admin.delegas.example'
const globalKey = () => keyedHash('delegas-login:global', TEST_PEPPER)

describe('disponibilidade do rate limit com D1 descartável', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  let database: D1Database
  const login = (ip: string, body = 'null') =>
    handleLogin(
      authRequest('login', {
        urlOrigin: origin,
        origin,
        body,
        headers: { 'CF-Connecting-IP': ip },
      }),
      { ...fixture.env, DELEGAS_DB: database, ADMIN_ORIGIN: origin },
    )
  const rows = async () =>
    (await fixture.db.prepare('SELECT * FROM admin_login_limits ORDER BY key').all()).results
  const globalAttempts = async () =>
    fixture.db
      .prepare('SELECT attempts FROM admin_login_limits WHERE key = ?')
      .bind(await globalKey())
      .first('attempts')

  beforeEach(async () => {
    fixture = await authFixture()
    database = fixture.db
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    await fixture?.runtime.dispose()
  })

  it('100 corpos malformados do mesmo IP consomem somente 20 tentativas globais; proprietário entra de outro IP', async () => {
    await seedOwner(fixture.db)
    for (let i = 0; i < 100; i++)
      expect((await login('198.51.100.1')).status).toBe(i < 20 ? 400 : 429)
    expect(await globalAttempts()).toBe(20)
    expect(await rows()).toHaveLength(2)
    const response = await login('198.51.100.2', loginBody())
    expect(response.status).toBe(200)
    expect(await globalAttempts()).toBe(21)
    const cookie = response.headers.get('set-cookie') ?? ''
    const env = { ...fixture.env, ADMIN_ORIGIN: origin }
    expect(
      (await handleMe(authRequest('me', { method: 'GET', urlOrigin: origin, origin, cookie }), env))
        .status,
    ).toBe(200)
    expect(
      (await handleLogout(authRequest('logout', { urlOrigin: origin, origin, cookie }), env))
        .status,
    ).toBe(200)
    expect(
      (await handleMe(authRequest('me', { method: 'GET', urlOrigin: origin, origin, cookie }), env))
        .status,
    ).toBe(401)
  })

  it('global saturado rejeita 300 IPs sem criar, incrementar ou limpar buckets', async () => {
    await fixture.db
      .prepare('INSERT INTO admin_login_limits (key, attempts, expires_at) VALUES (?, 100, ?)')
      .bind(await globalKey(), Date.now() + LOGIN_WINDOW_MS)
      .run()
    // Registros vencidos também permanecem intactos quando não há admissão.
    for (const name of ['expired-a', 'expired-b'])
      await fixture.db
        .prepare('INSERT INTO admin_login_limits (key, attempts, expires_at) VALUES (?, 1, 1)')
        .bind(await keyedHash(name, TEST_PEPPER))
        .run()
    const before = await rows()
    let mutationStatements = 0
    database = new Proxy(fixture.db, {
      get(target, key, receiver) {
        if (key === 'prepare')
          return (sql: string) => {
            if (/\b(INSERT|UPDATE|DELETE)\b/.test(sql)) mutationStatements++
            return target.prepare(sql)
          }
        return Reflect.get(target, key, receiver)
      },
    })
    const responses = await Promise.all(
      Array.from({ length: 300 }, (_, i) => login(`198.51.100.${i}`, loginBody())),
    )
    expect(responses.every((response) => response.status === 429)).toBe(true)
    expect(mutationStatements).toBe(0)
    expect(await rows()).toEqual(before)
    expect(await fixture.db.prepare('SELECT COUNT(*) FROM admin_sessions').first('COUNT(*)')).toBe(
      0,
    )
  })

  it('mesmo IP concorrente admite exatamente 20 e não amplifica o global', async () => {
    const responses = await Promise.all(Array.from({ length: 60 }, () => login('198.51.100.1')))
    expect(responses.filter((r) => r.status === 400)).toHaveLength(20)
    expect(responses.filter((r) => r.status === 429)).toHaveLength(40)
    expect(await globalAttempts()).toBe(20)
    expect(await rows()).toHaveLength(2)
  })

  it('múltiplos IPs concorrentes admitem exatamente 100; bloqueados não deixam buckets', async () => {
    const responses = await Promise.all(
      Array.from({ length: 150 }, (_, i) => login(`198.51.100.${i}`)),
    )
    expect(responses.filter((r) => r.status === 400)).toHaveLength(100)
    expect(responses.filter((r) => r.status === 429)).toHaveLength(50)
    expect(await globalAttempts()).toBe(100)
    expect(await rows()).toHaveLength(101)
    expect((await rows()).every((row) => Number(row.attempts) <= 100)).toBe(true)
  })

  it('username/IP mantém dez tentativas, não consome global após bloqueio e não bloqueia o proprietário em outra rede', async () => {
    await seedOwner(fixture.db)
    const responses = await Promise.all(
      Array.from({ length: 15 }, () => login('198.51.100.1', loginBody('OWNER', 'incorreta'))),
    )
    expect(responses.filter((r) => r.status === 401)).toHaveLength(10)
    expect(responses.filter((r) => r.status === 429)).toHaveLength(5)
    expect(await globalAttempts()).toBe(10)
    const before = await rows()
    expect((await login('198.51.100.1', loginBody())).status).toBe(429)
    expect(await rows()).toEqual(before)
    expect((await login('198.51.100.2', loginBody())).status).toBe(200)
    expect(await globalAttempts()).toBe(11)
  })

  it('última vaga global admite todos os buckets ou nenhum, incluindo username', async () => {
    await fixture.db
      .prepare('INSERT INTO admin_login_limits (key, attempts, expires_at) VALUES (?, 99, ?)')
      .bind(await globalKey(), Date.now() + LOGIN_WINDOW_MS)
      .run()
    let waiting = 0
    let release: () => void = () => {}
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const rejectedWrites: number[] = []
    database = new Proxy(fixture.db, {
      get(target, key, receiver) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            if (++waiting === 12) release()
            await barrier
            const results = await target.batch(statements)
            if (results[0].results.length === 0)
              rejectedWrites.push(
                results.reduce((sum, result) => sum + result.meta.rows_written, 0),
              )
            return results
          }
        return Reflect.get(target, key, receiver)
      },
    })
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        login(`198.51.100.${i}`, loginBody('owner', 'incorreta')),
      ),
    )
    expect(responses.filter((r) => r.status === 401)).toHaveLength(1)
    expect(responses.filter((r) => r.status === 429)).toHaveLength(11)
    expect(await globalAttempts()).toBe(100)
    expect(await rows()).toHaveLength(3)
    expect(rejectedWrites).toEqual(Array(11).fill(0))
  })

  it('ataque distribuído contra username continua limitado pelo global sem revogar sessões existentes', async () => {
    await seedOwner(fixture.db)
    const cookie = (await login('203.0.113.1', loginBody())).headers.get('set-cookie') ?? ''
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        login(`198.51.100.${Math.floor(i / 10)}`, loginBody('owner', 'incorreta')),
      ),
    )
    expect(responses.filter((r) => r.status === 401)).toHaveLength(99)
    expect(responses.filter((r) => r.status === 429)).toHaveLength(1)
    expect(await globalAttempts()).toBe(100)
    expect((await login('203.0.113.2', loginBody())).status).toBe(429)
    const env = { ...fixture.env, ADMIN_ORIGIN: origin }
    expect(
      (await handleMe(authRequest('me', { method: 'GET', origin, urlOrigin: origin, cookie }), env))
        .status,
    ).toBe(200)
    expect(
      (await handleLogout(authRequest('logout', { origin, urlOrigin: origin, cookie }), env))
        .status,
    ).toBe(200)
  })

  it('Retry-After usa a maior janela bloqueada, arredonda para cima e libera no instante da expiração', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await fixture.db.batch([
      fixture.db
        .prepare('INSERT INTO admin_login_limits VALUES (?, 100, ?)')
        .bind(await globalKey(), now + 1501),
      fixture.db
        .prepare('INSERT INTO admin_login_limits VALUES (?, 20, ?)')
        .bind(await keyedHash('delegas-login:ip:198.51.100.1', TEST_PEPPER), now + 2501),
    ])
    expect((await login('198.51.100.1')).headers.get('retry-after')).toBe('3')
    const before = await rows()
    vi.spyOn(Date, 'now').mockReturnValue(now + 1501)
    expect((await login('198.51.100.1')).headers.get('retry-after')).toBe('1')
    expect(await rows()).toEqual(before)
    vi.spyOn(Date, 'now').mockReturnValue(now + 2501)
    expect((await login('198.51.100.1')).status).toBe(400)
    expect(await globalAttempts()).toBe(1)
    expect(
      (await rows()).every(
        (row) => row.attempts === 1 && row.expires_at === now + 2501 + LOGIN_WINDOW_MS,
      ),
    ).toBe(true)
  })

  it('erro SQL durante reserva reverte todos os buckets e falha fechado', async () => {
    await seedOwner(fixture.db)
    await fixture.db
      .prepare(
        `CREATE TRIGGER fail_ip BEFORE INSERT ON admin_login_limits WHEN NEW.key = '${await keyedHash('delegas-login:ip:198.51.100.1', TEST_PEPPER)}' BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
      )
      .run()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await login('198.51.100.1', loginBody())
    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await rows()).toEqual([])
    expect(
      await fixture.db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').first('count'),
    ).toBe(0)
  })

  it('username não ASCII não vira identificador ASCII depois de lowercase', async () => {
    expect((await login('198.51.100.1', loginBody('Kelvin', 'incorreta'))).status).toBe(400)
    expect(await rows()).toHaveLength(2)
    expect(normalizeUsername('Kelvin')).toBeNull()
    expect(normalizeUsername(' OWNER ')).toBe('owner')
  })

  it.each([
    ['global', 99],
    ['ip:198.51.100.1', 19],
    [`username-ip:${JSON.stringify(['owner', '198.51.100.1'])}`, 9],
  ])(
    'última vaga de %s reserva também os buckets ausentes, sem admissão parcial',
    async (name, attempts) => {
      const key = await keyedHash(`delegas-login:${name}`, TEST_PEPPER)
      await fixture.db
        .prepare('INSERT INTO admin_login_limits VALUES (?, ?, ?)')
        .bind(key, attempts, Date.now() + LOGIN_WINDOW_MS)
        .run()
      expect((await login('198.51.100.1', loginBody('owner', 'incorreta'))).status).toBe(401)
      const before = await rows()
      expect(before).toHaveLength(3)
      expect((await login('198.51.100.1', loginBody('owner', 'incorreta'))).status).toBe(429)
      expect(await rows()).toEqual(before)
      expect(before.find((row) => row.key === key)?.attempts).toBe(attempts + 1)
    },
  )

  it('leitura de corpo que nunca termina expira em cinco segundos e cancela o stream sem aguardar o cancelamento', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const request = new Request(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream({ cancel }),
      duplex: 'half',
    } as RequestInit)
    const result = readLogin(request)
    await vi.advanceTimersByTimeAsync(LOGIN_BODY_TIMEOUT_MS)
    expect(await result).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('reserva usa o horário após concluir o corpo, mesmo atravessando a expiração da janela', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    await fixture.db
      .prepare('INSERT INTO admin_login_limits VALUES (?, 100, ?)')
      .bind(await globalKey(), now + 1)
      .run()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      },
    })
    const request = new Request(
      authRequest('login', {
        origin,
        urlOrigin: origin,
        headers: { 'CF-Connecting-IP': '198.51.100.1' },
      }),
      { body, duplex: 'half' } as RequestInit,
    )
    const response = handleLogin(request, { ...fixture.env, ADMIN_ORIGIN: origin })
    clock.mockReturnValue(now + 2)
    if (!controller) throw new Error('Stream de teste ausente')
    controller.enqueue(new TextEncoder().encode(loginBody('owner', 'incorreta')))
    controller.close()
    expect((await response).status).toBe(401)
    expect(await globalAttempts()).toBe(1)
  })

  it('pré-leitura lenta atravessando expiração não recusa nem inicia janela com horário antigo', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    await fixture.db
      .prepare('INSERT INTO admin_login_limits VALUES (?, 100, ?)')
      .bind(await globalKey(), now + 1)
      .run()
    database = new Proxy(fixture.db, {
      get(target, key, receiver) {
        if (key === 'prepare')
          return (sql: string) => {
            const statement = target.prepare(sql)
            if (!sql.includes('SELECT l.key')) return statement
            return new Proxy(statement, {
              get(query, member, queryReceiver) {
                if (member === 'bind')
                  return (...values: unknown[]) => {
                    const bound = query.bind(...values)
                    return new Proxy(bound, {
                      get(boundQuery, method, boundReceiver) {
                        if (method === 'all')
                          return async () => {
                            const result = await boundQuery.all()
                            clock.mockReturnValue(now + 2)
                            return result
                          }
                        return Reflect.get(boundQuery, method, boundReceiver)
                      },
                    })
                  }
                return Reflect.get(query, member, queryReceiver)
              },
            })
          }
        return Reflect.get(target, key, receiver)
      },
    })
    expect((await login('198.51.100.1')).status).toBe(400)
    expect(await globalAttempts()).toBe(1)
    expect((await rows()).every((row) => row.expires_at === now + 2 + LOGIN_WINDOW_MS)).toBe(true)
  })
})
