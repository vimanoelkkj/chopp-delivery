import { expect, it } from 'vitest'
import { handleLogin } from '../../server/auth/handlers'
import { authRequest, TEST_PASSWORD } from './auth-fixture'
import { cp3Fixture, draft, site } from './cms-v2-api-fixture'

async function login(env: Parameters<typeof handleLogin>[1]) {
  const response = await handleLogin(
    authRequest('login', {
      method: 'POST',
      body: JSON.stringify({ username: 'owner', password: TEST_PASSWORD }),
    }),
    env,
  )
  expect(response.status).toBe(200)
  const cookie = response.headers.get('Set-Cookie')?.split(';')[0]
  expect(cookie).toBeTruthy()
  return cookie as string
}

it('E6.2: duas sessões reais têm um vencedor, recibo imutável e catálogo intacto', async () => {
  const f = await cp3Fixture()
  try {
    const converted = await f.convert()
    expect(converted.response.status).toBe(200)
    const secondCookie = await login(f.env)
    expect(secondCookie).not.toBe(f.base.cookie)
    expect(await f.db.prepare('SELECT count(*) n FROM admin_sessions').first('n')).toBe(2)
    const first = await (await f.call('GET', site)).json()
    const second = await (
      await f.call('GET', site, undefined, undefined, { Cookie: secondCookie })
    ).json()
    expect(second.draft).toEqual(first.draft)
    const commercialBefore = JSON.stringify(
      (await f.db.prepare('SELECT * FROM catalog_items ORDER BY id').all()).results,
    )
    const input = (heading: string) => {
      const document = structuredClone(first.draft.document)
      document.modules[0].content.heading = heading
      return {
        action: 'saveDraft',
        operationId: crypto.randomUUID(),
        expectedRevision: first.draft.revision,
        document,
      }
    }
    const a = input('Texto da sessão A'),
      b = input('Texto da sessão B')
    const bodiesBefore = [JSON.stringify(a), JSON.stringify(b)]
    const responses = await Promise.all([
      f.call('PUT', draft, a, a.expectedRevision),
      f.call('PUT', draft, b, b.expectedRevision, { Cookie: secondCookie }),
    ])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    const index = responses[0].status === 200 ? 0 : 1
    const winning = index === 0 ? a : b
    const result = await responses[index].json()
    expect([JSON.stringify(a), JSON.stringify(b)]).toEqual(bodiesBefore)
    expect(await (await f.call('GET', site)).json()).toMatchObject({ draft: result.site.draft })
    expect(
      await (
        await f.call('GET', `${site}/commands/${winning.operationId}`, undefined, undefined, {
          Cookie: secondCookie,
        })
      ).json(),
    ).toEqual(result)
    expect(
      await (
        await f.call('PUT', draft, winning, winning.expectedRevision, { Cookie: secondCookie })
      ).json(),
    ).toEqual(result)
    const altered = { ...winning, document: structuredClone(winning.document) }
    altered.document.modules[0].content.heading = 'Colisão de payload'
    expect((await f.call('PUT', draft, altered, altered.expectedRevision)).status).toBe(409)
    const next = {
      ...winning,
      operationId: crypto.randomUUID(),
      expectedRevision: result.command.revision,
      document: structuredClone(winning.document),
    }
    next.document.modules[0].content.heading = 'Edição posterior'
    expect((await f.call('PUT', draft, next, next.expectedRevision)).status).toBe(200)
    expect(await (await f.call('GET', `${site}/commands/${winning.operationId}`)).json()).toEqual(
      result,
    )
    expect(
      JSON.stringify((await f.db.prepare('SELECT * FROM catalog_items ORDER BY id').all()).results),
    ).toBe(commercialBefore)
    expect(await f.db.prepare('SELECT count(*) n FROM cms_v2_versions').first('n')).toBe(3)
    expect((await f.call('PUT', draft, input('Sem If-Match'))).status).toBe(428)
  } finally {
    await f.close()
  }
}, 30000)

it('E6.2: revogação durante a transação desfaz versão/estado e preserva a revisão', async () => {
  const f = await cp3Fixture()
  try {
    const c = await f.convert()
    const before = await (await f.call('GET', site)).json()
    const command = {
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: c.result.command.revision,
      document: structuredClone(before.draft.document),
    }
    command.document.modules[0].content.heading = 'Não pode persistir'
    await f.db
      .prepare(
        'CREATE TRIGGER e62_revoke BEFORE UPDATE ON cms_v2_state BEGIN DELETE FROM admin_sessions; END',
      )
      .run()
    expect((await f.call('PUT', draft, command, command.expectedRevision)).status).toBe(401)
    expect(
      await f.db
        .prepare('SELECT count(*) n FROM cms_v2_versions WHERE operation_id=?')
        .bind(command.operationId)
        .first('n'),
    ).toBe(0)
    expect(await (await f.call('GET', site)).json()).toEqual(before)
    expect(await f.db.prepare('SELECT count(*) n FROM admin_sessions').first('n')).toBe(1)
  } finally {
    await f.close()
  }
}, 30000)

it('E6.2: expiração antes ou depois do commit não duplica nem perde recibos', async () => {
  const f = await cp3Fixture()
  try {
    const c = await f.convert()
    const input = {
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: c.result.command.revision,
      document: structuredClone(c.result.site.draft.document),
    }
    input.document.modules[0].content.heading = 'Persistido antes da revogação'
    await f.db.prepare('DELETE FROM admin_sessions').run()
    expect((await f.call('PUT', draft, input, input.expectedRevision)).status).toBe(401)
    expect(
      await f.db
        .prepare('SELECT count(*) n FROM cms_v2_versions WHERE operation_id=?')
        .bind(input.operationId)
        .first('n'),
    ).toBe(0)
    const cookie = await login(f.env)
    const response = await f.call('PUT', draft, input, input.expectedRevision, { Cookie: cookie })
    expect(response.status).toBe(200)
    const persisted = await response.json()
    await f.db.prepare('DELETE FROM admin_sessions').run()
    expect(
      (
        await f.call('GET', `${site}/commands/${input.operationId}`, undefined, undefined, {
          Cookie: cookie,
        })
      ).status,
    ).toBe(401)
    const fresh = await login(f.env)
    expect(
      await (
        await f.call('GET', `${site}/commands/${input.operationId}`, undefined, undefined, {
          Cookie: fresh,
        })
      ).json(),
    ).toEqual(persisted)
    expect(
      await (await f.call('PUT', draft, input, input.expectedRevision, { Cookie: fresh })).json(),
    ).toEqual(persisted)
    expect(
      await f.db
        .prepare('SELECT count(*) n FROM cms_v2_versions WHERE operation_id=?')
        .bind(input.operationId)
        .first('n'),
    ).toBe(1)
  } finally {
    await f.close()
  }
}, 30000)
