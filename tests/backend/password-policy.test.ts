import { describe, expect, it } from 'vitest'
import { bootstrapOwner, validateOwnerCredentials } from '../../server/auth/bootstrap'
import { PASSWORD_MAX_BYTES, passwordPolicyIssue } from '../../server/auth/password-policy'
import { authFixture, TEST_PEPPER } from './auth-fixture'

const issue = (password: string, username = 'owner') => passwordPolicyIssue(username, password)

describe('política de senha F2: 8 a 128 caracteres, até 512 bytes', () => {
  it('7 recusados, 8 aceitos', () => {
    expect(issue('aB3$eF7')).toBe('length')
    expect(issue('aB3$eF7h')).toBeNull()
  })

  it('128 aceitos, 129 recusados', () => {
    expect(issue('aB3$'.repeat(32))).toBeNull()
    expect(issue(`${'aB3$'.repeat(32)}x`)).toBe('length')
  })

  it('conta pontos de código, não unidades UTF-16 (emoji vale 1)', () => {
    expect(issue('🍺🍻🍺🍻🍺🍻🍺🍷')).toBeNull() // 8 pontos de código, 16 unidades UTF-16
    expect(issue('🍺🍻🍺🍻🍺🍻🍺')).toBe('length') // 7
  })

  it('512 bytes UTF-8: 128 pontos de código de 4 bytes cabem exatamente no teto', () => {
    const max = '🍺🍻'.repeat(64) // 128 pontos de código, 4 bytes cada
    expect(new TextEncoder().encode(max).length).toBe(PASSWORD_MAX_BYTES)
    expect(issue(max)).toBeNull()
    expect(issue(`${max}🍷`)).toBe('length') // 129 pontos de código (e 516 bytes)
    // Cada ponto de código tem no máximo 4 bytes: a regra de bytes é rede de segurança e nunca
    // é alcançada com 128 pontos de código ou menos.
  })

  it('recusa senhas comuns, repetitivas, em sequência e iguais ao usuário', () => {
    for (const weak of ['12345678', 'Password123', 'SENHA123', 'qwertyuiop', 'Chopp2026'])
      expect(issue(weak), weak).toBe('common')
    for (const weak of ['aaaaaaaa', '99999999', '23456789', 'hgfedcba'])
      expect(issue(weak), weak).toBe('repetitive')
    expect(issue('proprietario-x', 'proprietario-x')).toBe('username')
  })

  it('sem regras artificiais de composição: frase só com minúsculas é aceita', () => {
    expect(issue('cerveja gelada na sexta')).toBeNull()
  })

  it('o username continua com a regra própria', () => {
    expect(() => validateOwnerCredentials('Ab', 'aB3$eF7h')).toThrow()
    expect(() => validateOwnerCredentials('owner', 'aB3$eF7h')).not.toThrow()
    expect(() => validateOwnerCredentials('owner', 'aB3$eF7')).toThrow()
  })
})

describe('bootstrapOwner com a nova política', () => {
  it('7 não grava; 8 grava e a conta é única', async () => {
    const fixture = await authFixture()
    try {
      await expect(bootstrapOwner(fixture.db, 'owner', 'aB3$eF7', TEST_PEPPER)).rejects.toThrow()
      await expect(bootstrapOwner(fixture.db, 'owner', 'password', TEST_PEPPER)).rejects.toThrow()
      expect((await fixture.db.prepare('SELECT * FROM admin_users').all()).results).toHaveLength(0)
      expect(await bootstrapOwner(fixture.db, 'owner', 'aB3$eF7h', TEST_PEPPER)).toBe(true)
      expect(await bootstrapOwner(fixture.db, 'outro', 'zY9#xW8v', TEST_PEPPER)).toBe(false)
    } finally {
      await fixture.runtime.dispose()
    }
  })
})
