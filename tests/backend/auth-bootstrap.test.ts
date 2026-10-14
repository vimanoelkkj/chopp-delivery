import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bootstrapOwner } from '../../server/auth/bootstrap'
import { verifyPassword } from '../../server/auth/password'
import { authFixture, TEST_PASSWORD, TEST_PEPPER } from './auth-fixture'

describe('bootstrap local da conta proprietária', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  beforeEach(async () => {
    fixture = await authFixture()
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })

  it('cria somente a primeira conta com senha derivada e sem padrão', async () => {
    expect(await bootstrapOwner(fixture.db, 'owner', TEST_PASSWORD, TEST_PEPPER)).toBe(true)
    const owner = await fixture.db
      .prepare('SELECT id, username, password_hash FROM admin_users')
      .first<{ id: string; username: string; password_hash: string }>()
    expect(typeof owner?.id).toBe('string')
    expect(await verifyPassword(TEST_PASSWORD, owner?.password_hash ?? null, TEST_PEPPER)).toBe(
      true,
    )
    expect(
      await bootstrapOwner(fixture.db, 'another-owner', 'Outra frase longa de teste', TEST_PEPPER),
    ).toBe(false)
    expect((await fixture.db.prepare('SELECT * FROM admin_users').all()).results).toHaveLength(1)
    expect(await fixture.db.prepare('SELECT username FROM admin_users').first('username')).toBe(
      'owner',
    )
  })

  it('concorrência não cria duas contas', async () => {
    const outcomes = await Promise.all([
      bootstrapOwner(fixture.db, 'first', TEST_PASSWORD, TEST_PEPPER),
      bootstrapOwner(fixture.db, 'second', TEST_PASSWORD, TEST_PEPPER),
    ])
    expect(outcomes.sort()).toEqual([false, true])
  })

  it.each(['', 'curta'])('não aceita senha fraca (%s)', async (password) => {
    await expect(bootstrapOwner(fixture.db, 'owner', password, TEST_PEPPER)).rejects.toThrow()
    expect((await fixture.db.prepare('SELECT * FROM admin_users').all()).results).toHaveLength(0)
  })
})
