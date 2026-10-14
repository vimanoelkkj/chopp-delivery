import { describe, expect, it } from 'vitest'
import { authConfig } from '../../server/auth/http'
import { requestToken, sessionCookie } from '../../server/auth/session'

const pepper = 'ab'.repeat(32)
// Os testes de configuração não fazem I/O; o binding não é acessado.
const configEnv = (origin: string, local?: string) => ({
  ADMIN_ORIGIN: origin,
  ADMIN_PASSWORD_PEPPER: pepper,
  ADMIN_ALLOW_INSECURE_LOCAL: local,
})

describe('cookies e produção fechada', () => {
  const config = (origin: string, local?: string) =>
    authConfig(new Request(`${origin}/api/auth/me`), configEnv(origin, local))

  it.each(['http://localhost:8788', 'http://127.0.0.1:8788'])(
    'HTTP local exige opt-in explícito (%s)',
    (origin) => {
      expect(() => config(origin)).toThrow()
      const cookie = sessionCookie(config(origin, '1'), 'ab'.repeat(32))
      expect(cookie).toContain('delegas_admin_local_session=')
      expect(cookie).not.toContain('; Secure')
      expect(cookie).not.toContain('Domain=')
      expect(cookie).toContain('HttpOnly; SameSite=Strict')
    },
  )

  it('produção sempre usa Secure e __Host-, até com flag local acidental', () => {
    const cookie = sessionCookie(config('https://admin.delegas.example', '1'), 'ab'.repeat(32))
    expect(cookie).toContain('__Host-delegas_admin_session=')
    expect(cookie).toContain('; Secure')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Domain=')
  })

  it('flag local não permite HTTP remoto nem origem divergente', () => {
    expect(() => config('http://admin.delegas.example', '1')).toThrow()
    expect(() =>
      authConfig(
        new Request('https://evil.example/api/auth/me'),
        configEnv('https://admin.delegas.example'),
      ),
    ).toThrow()
  })

  it('cookie local ou da R&P não é aceito como cookie de produção', () => {
    const settings = config('https://admin.delegas.example')
    for (const name of ['delegas_admin_local_session', 'rp_admin_session']) {
      expect(
        requestToken(
          new Request('https://admin.delegas.example', {
            headers: { Cookie: `${name}=${'ab'.repeat(32)}` },
          }),
          settings,
        ),
      ).toBeNull()
    }
  })
})
