import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleLogin, handleLogout, handleMe } from '../../server/auth/handlers'
import { authFixture, authRequest, loginBody, seedOwner } from './auth-fixture'

describe('handlers reais de autenticação com D1 descartável', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  const login = (body = loginBody()) => handleLogin(authRequest('login', { body }), fixture.env)
  const me = (cookie?: string) =>
    handleMe(authRequest('me', { method: 'GET', cookie }), fixture.env)

  beforeEach(async () => {
    fixture = await authFixture()
    await seedOwner(fixture.db)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture?.runtime.dispose()
  })

  it('login correto retorna apenas usuário e guarda somente o hash do token', async () => {
    const response = await login()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      authenticated: true,
      user: { id: 'owner-test', username: 'owner' },
    })
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    const raw = cookie.split(';')[0].split('=')[1]
    const session = await fixture.db
      .prepare('SELECT token_hash FROM admin_sessions')
      .first<{ token_hash: string }>()
    expect(session?.token_hash).toHaveLength(64)
    expect(session?.token_hash).not.toBe(raw)
    expect((await me(cookie)).status).toBe(200)
  })

  it('senha incorreta, usuário inexistente e desativado têm a mesma resposta', async () => {
    const wrong = await login(loginBody('owner', 'incorreta'))
    const absent = await login(loginBody('absent', 'incorreta'))
    await fixture.db.prepare('UPDATE admin_users SET active = 0').run()
    const disabled = await login()
    expect([wrong.status, absent.status, disabled.status]).toEqual([401, 401, 401])
    expect(await wrong.json()).toEqual(await absent.json())
    expect(await disabled.json()).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Credenciais inválidas.' },
    })
    expect(
      await fixture.db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').first('count'),
    ).toBe(0)
  })

  it.each([
    undefined,
    'delegas_admin_local_session=invalid',
    `rp_admin_session=${'ab'.repeat(32)}`,
    `delegas_admin_local_session=%ZZ`,
    `delegas_admin_local_session=${'00'.repeat(32)}; delegas_admin_local_session=${'00'.repeat(32)}`,
  ])('recusa cookie ausente, de outro projeto ou malformado (%s)', async (cookie) => {
    expect((await me(cookie)).status).toBe(401)
  })

  it('recusa token adulterado, expirado e revogado; logout repetido é idempotente', async () => {
    const cookie = (await login()).headers.get('set-cookie') ?? ''
    const [name, value] = cookie.split(';')[0].split('=')
    const modified = `${name}=${value[0] === 'a' ? 'b' : 'a'}${value.slice(1)}`
    expect((await me(modified)).status).toBe(401)
    await fixture.db.prepare('UPDATE admin_sessions SET created_at = 0, expires_at = 1').run()
    expect((await me(cookie)).status).toBe(401)
    const fresh = (await login()).headers.get('set-cookie') ?? ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handleLogout(authRequest('logout', { cookie: fresh }), fixture.env)
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    }
    expect((await me(fresh)).status).toBe(401)
  })

  it('desativar e reativar não restaura sessões anteriores', async () => {
    const cookie = (await login()).headers.get('set-cookie') ?? ''
    await fixture.db.prepare('UPDATE admin_users SET active = 0').run()
    expect((await me(cookie)).status).toBe(401)
    await fixture.db.prepare('UPDATE admin_users SET active = 1').run()
    expect((await me(cookie)).status).toBe(401)
    expect(
      await fixture.db.prepare('SELECT auth_version FROM admin_users').first('auth_version'),
    ).toBe(3)
  })

  it.each([
    'null',
    '[]',
    '1',
    '"text"',
    '{',
    '{}',
    '{"username":1,"password":"x"}',
    '{"username":"owner","password":false}',
    '{"username":"owner","password":"x","role":"owner"}',
    JSON.stringify({ username: 'owner', password: 'x'.repeat(3000) }),
  ])('trata JSON e estrutura inválidos sem efeitos de sessão', async (body) => {
    const response = await login(body)
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(
      await fixture.db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').first('count'),
    ).toBe(0)
  })

  it.each([null, 'null', 'https://attacker.example'])(
    'escrita sem origem válida é negada (%s)',
    async (origin) => {
      expect(
        (await handleLogin(authRequest('login', { body: loginBody(), origin }), fixture.env))
          .status,
      ).toBe(403)
      expect((await handleLogout(authRequest('logout', { origin }), fixture.env)).status).toBe(403)
    },
  )

  it('aceita Referer válido na ausência de Origin, mas Origin inválido prevalece', async () => {
    const headers = { Referer: `${fixture.env.ADMIN_ORIGIN}/admin` }
    expect(
      (
        await handleLogin(
          authRequest('login', { body: loginBody(), origin: null, headers }),
          fixture.env,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await handleLogin(
          authRequest('login', { body: loginBody(), origin: 'null', headers }),
          fixture.env,
        )
      ).status,
    ).toBe(403)
  })

  it('falha de banco não expõe SQL, credenciais ou erro interno', async () => {
    await fixture.db.prepare('DROP TABLE admin_login_limits').run()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await login()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: { code: 'AUTH_UNAVAILABLE', message: 'Autenticação indisponível no momento.' },
    })
    expect(log).toHaveBeenCalledWith('AUTH_UNAVAILABLE')
  })

  it('limita corpo real mesmo com Content-Length falso e rejeita tipo de mídia errado', async () => {
    const cases: { body: string; headers: Record<string, string> }[] = [
      { body: loginBody('owner', 'x'.repeat(3000)), headers: { 'Content-Length': '1' } },
      { body: loginBody(), headers: { 'Content-Type': 'text/plain' } },
    ]
    for (const options of cases) {
      const response = await handleLogin(authRequest('login', options), fixture.env)
      expect(response.status).toBe(400)
      expect(
        await fixture.db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').first('count'),
      ).toBe(0)
    }
  })

  it('configuração ausente falha fechada e métodos não previstos são recusados', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      (await handleLogin(authRequest('login', { body: loginBody() }), { DELEGAS_DB: fixture.db }))
        .status,
    ).toBe(503)
    for (const [handler, path, method, allow] of [
      [handleLogin, 'login', 'GET', 'POST'],
      [handleLogout, 'logout', 'GET', 'POST'],
      [handleMe, 'me', 'HEAD', 'GET'],
    ] as const) {
      const response = await handler(authRequest(path, { method }), fixture.env)
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe(allow)
      expect(response.headers.get('cache-control')).toBe('no-store')
      if (method === 'HEAD') expect(await response.text()).toBe('')
    }
  })
})
