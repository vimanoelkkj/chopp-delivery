import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAdmin } from '../../server/auth/guard'
import { handleLogin, handleMe } from '../../server/auth/handlers'
import { authConfig, validWriteOrigin } from '../../server/auth/http'
import { hashPassword } from '../../server/auth/password'
import { LOGIN_WINDOW_MS } from '../../server/auth/rate-limit'
import { adminWriteProof } from '../../server/auth/session'
import {
  authFixture,
  authRequest,
  loginBody,
  seedOwner,
  TEST_PASSWORD,
  TEST_PEPPER,
} from './auth-fixture'

describe('concorrência e guards administrativos', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  const login = (username = 'owner', password = TEST_PASSWORD) =>
    handleLogin(authRequest('login', { body: loginBody(username, password) }), fixture.env)
  beforeEach(async () => {
    fixture = await authFixture()
    await seedOwner(fixture.db)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture?.runtime.dispose()
  })

  it.each(['disable', 'password', 'disable-enable'])(
    'login concorrente com %s não cria sessão obsoleta',
    async (change) => {
      let creatingSession = false
      const db = new Proxy(fixture.db, {
        get(target, key, receiver) {
          if (key === 'prepare')
            return (sql: string) => {
              if (sql.includes('INSERT INTO admin_sessions')) creatingSession = true
              return target.prepare(sql)
            }
          if (key === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              if (creatingSession) {
                creatingSession = false
                if (change === 'password') {
                  await target
                    .prepare('UPDATE admin_users SET password_hash = ?')
                    .bind(await hashPassword(TEST_PASSWORD, TEST_PEPPER))
                    .run()
                } else {
                  await target.prepare('UPDATE admin_users SET active = 0').run()
                  if (change === 'disable-enable')
                    await target.prepare('UPDATE admin_users SET active = 1').run()
                }
              }
              return target.batch(statements)
            }
          return Reflect.get(target, key, receiver)
        },
      })
      const response = await handleLogin(authRequest('login', { body: loginBody() }), {
        ...fixture.env,
        DELEGAS_DB: db,
      })
      expect(response.status).toBe(401)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(
        await fixture.db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').first('count'),
      ).toBe(0)
    },
  )

  it('mudança de senha, até para a mesma senha, revoga tokens já emitidos', async () => {
    const cookie = (await login()).headers.get('set-cookie') ?? ''
    await fixture.db
      .prepare('UPDATE admin_users SET password_hash = ?')
      .bind(await hashPassword(TEST_PASSWORD, TEST_PEPPER))
      .run()
    expect((await handleMe(authRequest('me', { method: 'GET', cookie }), fixture.env)).status).toBe(
      401,
    )
  })

  it('logins concorrentes válidos têm tokens distintos, sem estado global de sessão', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => login()))
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200])
    expect(new Set(responses.map((response) => response.headers.get('set-cookie'))).size).toBe(5)
    expect(
      await fixture.db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').first('count'),
    ).toBe(5)
  })

  it('limite por username/IP admite no máximo dez tentativas concorrentes e expira sem prorrogação', async () => {
    const responses = await Promise.all(
      Array.from({ length: 15 }, () => login('owner', 'incorreta')),
    )
    expect(responses.filter((response) => response.status === 401)).toHaveLength(10)
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5)
    const blocked = responses.find((response) => response.status === 429)
    expect(Number(blocked?.headers.get('retry-after'))).toBeGreaterThan(0)
    const before = await fixture.db
      .prepare('SELECT key, expires_at FROM admin_login_limits ORDER BY key')
      .all()
    expect((await login()).status).toBe(429)
    expect(
      (
        await fixture.db
          .prepare('SELECT key, expires_at FROM admin_login_limits ORDER BY key')
          .all()
      ).results,
    ).toEqual(before.results)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + LOGIN_WINDOW_MS + 1)
    expect((await login('owner', 'incorreta')).status).toBe(401)
  })

  it('IP local não é contornado por cabeçalho forjado; dados dos buckets são opacos', async () => {
    for (let i = 0; i < 21; i++) {
      const response = await handleLogin(
        authRequest('login', {
          body: loginBody(`user-${i}`, 'incorreta'),
          headers: { 'CF-Connecting-IP': `198.51.100.${i}` },
        }),
        fixture.env,
      )
      expect(response.status).toBe(i < 20 ? 401 : 429)
    }
    const rows = await fixture.db
      .prepare('SELECT key FROM admin_login_limits')
      .all<{ key: string }>()
    expect(rows.results.every((row) => /^[a-f0-9]{64}$/.test(row.key))).toBe(true)
  })

  it('limite global persiste no D1 mesmo para JSON malformado, antes de qualquer KDF', async () => {
    const origin = 'https://admin.delegas.example'
    const env = { ...fixture.env, ADMIN_ORIGIN: origin }
    for (let i = 0; i < 101; i++) {
      const response = await handleLogin(
        authRequest('login', {
          urlOrigin: origin,
          origin,
          body: 'null',
          headers: { 'CF-Connecting-IP': `198.51.100.${i}` },
        }),
        env,
      )
      expect(response.status).toBe(i < 100 ? 400 : 429)
    }
  })

  it('guard exige sessão mesmo com origem válida e exige origem mesmo com sessão', async () => {
    const empty = await requireAdmin(authRequest('future-admin', { method: 'PATCH' }), fixture.env)
    expect(empty.error?.status).toBe(401)
    const cookie = (await login()).headers.get('set-cookie') ?? ''
    const missingOrigin = await requireAdmin(
      authRequest('future-admin', { method: 'PATCH', cookie, origin: null }),
      fixture.env,
    )
    expect(missingOrigin.error?.status).toBe(403)
    const valid = await requireAdmin(
      authRequest('future-admin', { method: 'PATCH', cookie }),
      fixture.env,
    )
    expect(valid.principal?.user).toEqual({ id: 'owner-test', username: 'owner' })
  })

  it('prova SQL impede escrita após desativação posterior ao guard', async () => {
    const cookie = (await login()).headers.get('set-cookie') ?? ''
    const authorization = await requireAdmin(
      authRequest('future-admin', { method: 'PATCH', cookie }),
      fixture.env,
    )
    if (!authorization.principal || !authorization.config)
      throw new Error('Guard recusou sessão de teste')
    const proof = adminWriteProof(authorization.principal, authorization.config)
    const update = () =>
      fixture.db
        .prepare(`UPDATE products SET name = ? WHERE id = ? AND ${proof.sql} RETURNING id`)
        .bind('Alteração de teste', 'dronken', ...proof.values)
        .all()
    // meta.changes inclui a escrita da revisão feita pelo trigger da migration 0004.
    expect((await update()).results).toEqual([{ id: 'dronken' }])
    expect(await fixture.db.prepare('SELECT revision FROM catalog_meta').first('revision')).toBe(1)
    await fixture.db.prepare('UPDATE admin_users SET active = 0').run()
    const blocked = await update()
    expect(blocked.results).toEqual([])
    expect(blocked.meta.changes).toBe(0)
    expect(await fixture.db.prepare('SELECT revision FROM catalog_meta').first('revision')).toBe(1)
  })

  it('sessão do Delegas não autentica em outro banco', async () => {
    const other = await authFixture()
    try {
      const cookie = (await login()).headers.get('set-cookie') ?? ''
      expect((await handleMe(authRequest('me', { method: 'GET', cookie }), other.env)).status).toBe(
        401,
      )
    } finally {
      await other.runtime.dispose()
    }
  })

  it.each(['expiry', 'origin', 'version', 'logout', 'password'])(
    'prova SQL reavalia %s depois do guard',
    async (change) => {
      const cookie = (await login()).headers.get('set-cookie') ?? ''
      const authorization = await requireAdmin(
        authRequest('future-admin', { method: 'PATCH', cookie }),
        fixture.env,
      )
      if (!authorization.principal || !authorization.config)
        throw new Error('Guard recusou sessão de teste')
      const proof = adminWriteProof(authorization.principal, authorization.config)
      if (change === 'expiry')
        await fixture.db.prepare('UPDATE admin_sessions SET created_at = 0, expires_at = 1').run()
      if (change === 'origin')
        await fixture.db
          .prepare('UPDATE admin_sessions SET origin = ?')
          .bind('https://another.example')
          .run()
      if (change === 'version')
        await fixture.db.prepare('UPDATE admin_sessions SET auth_version = 0').run()
      if (change === 'logout') {
        const { handleLogout } = await import('../../server/auth/handlers')
        expect((await handleLogout(authRequest('logout', { cookie }), fixture.env)).status).toBe(
          200,
        )
      }
      if (change === 'password')
        await fixture.db
          .prepare('UPDATE admin_users SET password_hash = ?')
          .bind(await hashPassword(TEST_PASSWORD, TEST_PEPPER))
          .run()
      expect(
        await fixture.db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').first('count'),
      ).toBe(['expiry', 'origin', 'version'].includes(change) ? 1 : 0)
      const result = await fixture.db
        .prepare(`UPDATE products SET name = ? WHERE id = ? AND ${proof.sql}`)
        .bind('Não autorizado', 'dronken', ...proof.values)
        .run()
      expect(result.meta.changes).toBe(0)
      expect(
        (await handleMe(authRequest('me', { method: 'GET', cookie }), fixture.env)).status,
      ).toBe(401)
    },
  )

  it('origem malformada, Referer externo e Fetch-Site cross-site falham fechados', () => {
    const config = authConfig(authRequest('login'), fixture.env)
    const cases: Record<string, string>[] = [
      { Referer: 'invalid' },
      { Referer: 'https://attacker.example/admin' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]
    for (const headers of cases) {
      expect(validWriteOrigin(authRequest('login', { origin: null, headers }), config)).toBe(false)
    }
  })
})
