import { handleLogin } from '../../server/auth/handlers'
import { handleCmsDraft, handleCmsSite } from '../../server/cms/handlers'
import type { CmsAdminSnapshot, CmsCommandResult, CmsMutation } from '../../shared/cms'
import { applyTestMigration, authRequest, loginBody, seedOwner, TEST_ORIGIN } from './auth-fixture'
import { cmsDocument } from './cms-document-fixture'
import { expansionFixture } from './expansion-fixture'

export async function cmsFixture() {
  const fixture = await expansionFixture()
  try {
    await applyTestMigration(fixture.db, '0006_cms_foundation.sql')
    await fixture.db
      .prepare('INSERT INTO d1_migrations VALUES (?)')
      .bind('0006_cms_foundation.sql')
      .run()
    await seedOwner(fixture.db)
    const login = await handleLogin(authRequest('login', { body: loginBody() }), fixture.env)
    const cookie = login.headers.get('set-cookie') ?? ''
    if (!cookie) throw new Error('CMS fixture login failed')
    const request = (
      method: string,
      body?: unknown,
      revision?: string,
      headers: Record<string, string> = {},
    ) =>
      new Request(`${TEST_ORIGIN}/api/admin/site${method === 'PUT' ? '/draft' : ''}`, {
        method,
        headers: {
          Origin: TEST_ORIGIN,
          Cookie: cookie,
          'Content-Type': 'application/json',
          ...(revision ? { 'If-Match': `"${revision}"` } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const get = () => handleCmsSite(request('GET'), fixture.env)
    const initial = (await (await get()).json()) as CmsAdminSnapshot
    const command = (revision = initial.draft.revision): CmsMutation => ({
      action: 'saveDraft',
      operationId: crypto.randomUUID(),
      expectedRevision: revision,
      document: cmsDocument(),
    })
    const save = async (input: CmsMutation) => {
      const response = await handleCmsDraft(
        request('PUT', input, input.expectedRevision),
        fixture.env,
      )
      return { response, result: (await response.json()) as CmsCommandResult }
    }
    const count = async (table: 'cms_versions' | 'cms_media_refs') =>
      (await fixture.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n
    const catalog = async () =>
      JSON.stringify(
        await fixture.db
          .batch([
            fixture.db.prepare('SELECT * FROM catalog_meta'),
            fixture.db.prepare('SELECT * FROM catalog_categories ORDER BY id'),
            fixture.db.prepare('SELECT * FROM catalog_items ORDER BY id'),
            fixture.db.prepare('SELECT * FROM catalog_variants ORDER BY item_id,code'),
            fixture.db.prepare('SELECT * FROM products ORDER BY id'),
            fixture.db.prepare('SELECT * FROM cachaca ORDER BY id'),
          ])
          .then((results) => results.map((result) => result.results)),
      )
    return { ...fixture, cookie, initial, request, get, command, save, count, catalog }
  } catch (error) {
    await fixture.runtime.dispose()
    throw error
  }
}
export async function seedCmsMedia(db: D1Database, id: string, state = 'quarantined') {
  await db
    .prepare('INSERT INTO cms_media(media_id,state,created_at) VALUES (?,?,?)')
    .bind(id, state, Date.now())
    .run()
}
