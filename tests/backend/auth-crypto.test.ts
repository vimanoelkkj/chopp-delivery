import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../server/auth/password'

const pepper = 'ab'.repeat(32)

describe('senhas Web Crypto', () => {
  it('usa salt próprio, verifica a senha e depende do pepper', async () => {
    const password = 'Uma frase de teste longa'
    const first = await hashPassword(password, pepper)
    const second = await hashPassword(password, pepper)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^pbkdf2-sha256-hmac-v1\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/)
    expect(first).not.toContain(password)
    expect(await verifyPassword(password, first, pepper)).toBe(true)
    expect(await verifyPassword('outra senha', first, pepper)).toBe(false)
    expect(await verifyPassword(password, first, 'cd'.repeat(32))).toBe(false)
  })

  it('recusa hash malformado ou custo rebaixado', async () => {
    const hash = await hashPassword('Uma frase de teste longa', pepper)
    for (const value of ['invalid', hash.replace('$100000$', '$1$'), `${hash}$extra`]) {
      expect(await verifyPassword('Uma frase de teste longa', value, pepper)).toBe(false)
    }
  })
})
