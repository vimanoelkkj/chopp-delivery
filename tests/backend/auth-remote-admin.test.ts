import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleLogin, handleLogout, handleMe } from '../../server/auth/handlers'
import { authConfig } from '../../server/auth/http'
import { verifyPassword } from '../../server/auth/password'
import { recoverOwnerCredentials } from '../../server/auth/recovery'
import { handleMediaList } from '../../server/cms/media-queries'
import { authFixture, loginBody, seedOwner, TEST_PASSWORD, TEST_PEPPER } from './auth-fixture'

const origin = 'https://homologation.example'
const replacement = 'Uma nova frase longa somente para testes'

describe('M3C: F2 HTTPS and trusted recovery core, exclusively in disposable D1', () => {
  let f: Awaited<ReturnType<typeof authFixture>>
  beforeEach(async () => {
    f = await authFixture()
    await seedOwner(f.db)
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  const settings = () => ({ ...f.env, ADMIN_ORIGIN: origin, ADMIN_ALLOW_INSECURE_LOCAL: undefined })
  const request = (
    path: string,
    method = 'GET',
    cookie?: string,
    headers: Record<string, string> = {},
  ) =>
    new Request(`${origin}/api/auth/${path}`, {
      method,
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers },
    })
  const login = () =>
    handleLogin(
      new Request(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: loginBody(),
      }),
      settings(),
    )
  const command = () => ({
    ownerId: 'owner-test',
    username: 'owner',
    expectedAuthVersion: 1,
    password: replacement,
  })

  it('reuses F2 login, secure host-only cookie, hashed token and logout on HTTPS', async () => {
    const response = await login()
    expect(response.status).toBe(200)
    const cookie = response.headers.get('Set-Cookie') ?? ''
    expect(cookie).toMatch(/^__Host-delegas_admin_session=[a-f0-9]{64};/)
    for (const flag of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict'])
      expect(cookie).toContain(flag)
    expect(cookie).not.toContain('Domain=')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = JSON.stringify(await response.json())
    for (const secret of [TEST_PASSWORD, TEST_PEPPER, 'password_hash', 'token_hash'])
      expect(body).not.toContain(secret)
    const stored = await f.db
      .prepare('SELECT token_hash, origin FROM admin_sessions')
      .first<{ token_hash: string; origin: string }>()
    expect(stored?.origin).toBe(origin)
    expect(stored?.token_hash).not.toBe(cookie.split('=')[1].split(';')[0])
    expect((await handleMe(request('me', 'GET', cookie), settings())).status).toBe(200)
    expect((await handleLogout(request('logout', 'POST', cookie), settings())).status).toBe(200)
    expect((await handleMe(request('me', 'GET', cookie), settings())).status).toBe(401)
  })

  it('does not treat spoofed Access headers as an F2 session', async () => {
    expect(
      (
        await handleMe(
          request('me', 'GET', undefined, {
            'Cf-Access-Authenticated-User-Email': 'operator@example.test',
            'Cf-Access-Jwt-Assertion': 'untrusted',
          }),
          settings(),
        )
      ).status,
    ).toBe(401)
  })

  it('rejects cross-origin and cross-site logout and preserves the valid session', async () => {
    const cookie = (await login()).headers.get('Set-Cookie') ?? ''
    const rejectedHeaders: Record<string, string>[] = [
      { Origin: 'https://attacker.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]
    for (const headers of rejectedHeaders)
      expect(
        (await handleLogout(request('logout', 'POST', cookie, headers), settings())).status,
      ).toBe(403)
    const absent = new Request(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect((await handleLogout(absent, settings())).status).toBe(403)
    expect((await handleMe(request('me', 'GET', cookie), settings())).status).toBe(200)
  })

  it('binds sessions to origin and database, not to a shared cookie name', async () => {
    const cookie = (await login()).headers.get('Set-Cookie') ?? ''
    const otherOrigin = 'https://production.example'
    expect(
      (
        await handleMe(new Request(`${otherOrigin}/api/auth/me`, { headers: { Cookie: cookie } }), {
          ...settings(),
          ADMIN_ORIGIN: otherOrigin,
        })
      ).status,
    ).toBe(401)
    const other = await authFixture()
    try {
      expect(
        (await handleMe(request('me', 'GET', cookie), { ...settings(), DELEGAS_DB: other.db }))
          .status,
      ).toBe(401)
    } finally {
      await other.runtime.dispose()
    }
    expect(
      (
        await handleMe(
          request(
            'me',
            'GET',
            cookie.replace('__Host-delegas_admin_session', 'delegas_admin_local_session'),
          ),
          settings(),
        )
      ).status,
    ).toBe(401)
  })

  it('requires HTTPS, exact canonical origin and a valid pepper outside loopback', () => {
    for (const bad of [
      {
        ...settings(),
        ADMIN_ORIGIN: 'http://homologation.example',
        ADMIN_ALLOW_INSECURE_LOCAL: '1',
      },
      { ...settings(), ADMIN_ORIGIN: `${origin}/admin` },
      { ...settings(), ADMIN_ORIGIN: 'https://production.example' },
      { ...settings(), ADMIN_PASSWORD_PEPPER: '' },
    ])
      expect(() => authConfig(request('me'), bad)).toThrow()
    expect(
      authConfig(request('me'), { ...settings(), ADMIN_ALLOW_INSECURE_LOCAL: '1' }).local,
    ).toBe(false)
  })

  it('HTTPS authentication does not enable the local-only media APIs', async () => {
    const cookie = (await login()).headers.get('Set-Cookie') ?? ''
    expect(
      (
        await handleMediaList(request('media', 'GET', cookie), {
          ...settings(),
          CMS_MEDIA_LOCAL: 'disposable-v1',
          ADMIN_ALLOW_INSECURE_LOCAL: '1',
        })
      ).status,
    ).toBe(404)
  })

  it('trusted core recovery preserves identity and revokes all old sessions atomically', async () => {
    const cookie = (await login()).headers.get('Set-Cookie') ?? ''
    expect(await recoverOwnerCredentials(f.db, command(), TEST_PEPPER)).toBe(true)
    const owner = await f.db
      .prepare('SELECT id, username, auth_version, password_hash FROM admin_users')
      .first<{ id: string; username: string; auth_version: number; password_hash: string }>()
    expect(owner).toMatchObject({ id: 'owner-test', username: 'owner', auth_version: 2 })
    expect(await verifyPassword(replacement, owner?.password_hash ?? null, TEST_PEPPER)).toBe(true)
    expect(await verifyPassword(TEST_PASSWORD, owner?.password_hash ?? null, TEST_PEPPER)).toBe(
      false,
    )
    expect((await handleMe(request('me', 'GET', cookie), settings())).status).toBe(401)
    expect(await f.db.prepare('SELECT count(*) n FROM admin_sessions').first('n')).toBe(0)
    expect((await login()).status).toBe(401)
    const next = await handleLogin(
      new Request(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: loginBody('owner', replacement),
      }),
      settings(),
    )
    expect(next.status).toBe(200)
  })

  it('stale or concurrent recovery never replaces newer credentials', async () => {
    const results = await Promise.all([
      recoverOwnerCredentials(f.db, command(), TEST_PEPPER),
      recoverOwnerCredentials(
        f.db,
        { ...command(), password: 'Outra senha concorrente apenas para teste' },
        TEST_PEPPER,
      ),
    ])
    expect(results.sort()).toEqual([false, true])
    const before = await f.db.prepare('SELECT * FROM admin_users').all()
    expect(await recoverOwnerCredentials(f.db, command(), TEST_PEPPER)).toBe(false)
    expect((await f.db.prepare('SELECT * FROM admin_users').all()).results).toEqual(before.results)
  })

  it('rejects wrong identity and never reactivates a disabled owner', async () => {
    for (const change of [{ ownerId: 'another-owner' }, { username: 'another-owner' }])
      expect(await recoverOwnerCredentials(f.db, { ...command(), ...change }, TEST_PEPPER)).toBe(
        false,
      )
    await f.db.prepare('UPDATE admin_users SET active=0').run()
    expect(
      await recoverOwnerCredentials(f.db, { ...command(), expectedAuthVersion: 2 }, TEST_PEPPER),
    ).toBe(false)
    expect(await f.db.prepare('SELECT active FROM admin_users').first('active')).toBe(0)
  })

  it('invalid recovery input never writes and failure inside SQL rolls back revocation', async () => {
    for (const change of [{ password: 'short' }, { expectedAuthVersion: 0 }, { ownerId: '' }])
      await expect(
        recoverOwnerCredentials(f.db, { ...command(), ...change }, TEST_PEPPER),
      ).rejects.toThrow()
    const cookie = (await login()).headers.get('Set-Cookie') ?? ''
    const before = (await f.db.prepare('SELECT * FROM admin_users').all()).results
    await f.db
      .prepare(
        `CREATE TRIGGER injected_recovery_failure AFTER DELETE ON admin_sessions BEGIN SELECT RAISE(ABORT,'TEST_RECOVERY_ABORT'); END`,
      )
      .run()
    await expect(recoverOwnerCredentials(f.db, command(), TEST_PEPPER)).rejects.toThrow()
    expect((await f.db.prepare('SELECT * FROM admin_users').all()).results).toEqual(before)
    expect((await handleMe(request('me', 'GET', cookie), settings())).status).toBe(200)
  })
})
