import { expect, it } from 'vitest'
import { requireAdmin } from '../../server/auth/guard'
import { handleLogin } from '../../server/auth/handlers'
import { handleCmsCommand } from '../../server/cms/handlers'
import { cmsRepository } from '../../server/cms/repository'
import { validateCmsMutation } from '../../server/cms/validation'
import { authRequest, loginBody } from './auth-fixture'
import { cmsFixture, seedCmsMedia } from './cms-fixture'

it('a revoked session cannot recover or replay a receipt; another owner session still can', async () => {
  const f = await cmsFixture()
  try {
    const input = f.command()
    const saved = await f.save(input)
    expect(saved.response.status).toBe(200)
    const firstAuth = await requireAdmin(f.request('GET'), f.env)
    if (firstAuth.error) throw new Error('First session authentication failed')
    const login = await handleLogin(authRequest('login', { body: loginBody() }), f.env)
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) throw new Error('Missing second owner session')
    const secondRequest = f.request('GET', undefined, undefined, { Cookie: cookie })
    await f.db
      .prepare('DELETE FROM admin_sessions WHERE token_hash=?')
      .bind(firstAuth.principal.sessionHash)
      .run()
    expect((await handleCmsCommand(f.request('GET'), f.env, input.operationId)).status).toBe(401)
    await expect(cmsRepository(f.db, firstAuth).save(input)).rejects.toThrow(/CMS_UNAUTHORIZED/)
    const receipt = await handleCmsCommand(secondRequest, f.env, input.operationId)
    expect(receipt.status).toBe(200)
    expect(await receipt.json()).toEqual(saved.result)
    const secondAuth = await requireAdmin(secondRequest, f.env)
    if (secondAuth.error) throw new Error('Second session authentication failed')
    expect(await cmsRepository(f.db, secondAuth).save(input)).toEqual(saved.result)
    expect(await f.count('cms_versions')).toBe(1)
    expect(await f.db.prepare('SELECT draft_revision FROM cms_state').first('draft_revision')).toBe(
      saved.result.command.revision,
    )
  } finally {
    await f.runtime.dispose()
  }
})

it('a structurally publishable command is blocked by HTTP, repository and SQL', async () => {
  const f = await cmsFixture()
  try {
    const media = `media_${crypto.randomUUID()}`
    await seedCmsMedia(f.db, media)
    const input = f.command()
    input.document.commercial.whatsappNumber = '5500000000000'
    Object.assign(input.document.modules[0].content, {
      heading: 'Private editorial heading',
      summary: 'Private summary',
      media: { id: media, alt: 'Editorial image' },
    })
    Object.assign(input.document.modules[1].content, { heading: 'Catalog', intro: 'Introduction' })
    Object.assign(input.document.modules[2].content, { heading: 'Contact', body: 'Delivery only' })
    const publish = { ...input, action: 'publish' as const }
    expect(validateCmsMutation(publish).value).toEqual(publish)
    const blocked = await f.save(publish)
    expect(blocked.response.status).toBe(400)
    expect(await f.count('cms_versions')).toBe(0)
    const auth = await requireAdmin(f.request('GET'), f.env)
    if (auth.error) throw new Error('Authentication failed')
    await expect(cmsRepository(f.db, auth).save(publish)).rejects.toThrow(/CMS_INVALID_COMMAND/)
    expect((await f.save(input)).response.status).toBe(200)
    await expect(
      f.db
        .prepare(
          `INSERT INTO cms_versions SELECT ?, 'published', ?, expected_revision, ?, document_json,
          command_hash, actor_id, created_at FROM cms_versions LIMIT 1`,
        )
        .bind(`version_${crypto.randomUUID()}`, crypto.randomUUID(), `c1_${crypto.randomUUID()}`)
        .run(),
    ).rejects.toThrow(/CMS_PUBLICATION_DISABLED/)
    expect(await f.count('cms_versions')).toBe(1)
    expect(await f.db.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] })
    expect(
      await f.db.prepare('SELECT published_version_id,published_revision FROM cms_state').first(),
    ).toEqual({ published_version_id: null, published_revision: null })
  } finally {
    await f.runtime.dispose()
  }
})
