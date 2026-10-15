import { parseIfMatch, revisionToken } from '../admin-catalog/catalog-contract'
import { readPatchBody } from '../admin-catalog/validation'
import { requireAdmin } from '../auth/guard'
import { type AuthEnv, authError, authJson, wrongMethod } from '../auth/http'
import { expandedRepository, publicSnapshot } from './repository'
import { EXPANSION_LIMITS, validateExpanded } from './validation'

export const catalogFailure = () =>
  authJson(
    { error: { code: 'CATALOG_UNAVAILABLE', message: 'Catálogo indisponível no momento.' } },
    503,
  )
const invalid = (fields: Record<string, string>) =>
  authJson({ error: { code: 'VALIDATION_ERROR', message: 'Catálogo inválido.', fields } }, 400)
export async function handlePublicCatalog(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== 'GET') return wrongMethod(request, 'GET')
  try {
    return authJson(publicSnapshot((await expandedRepository(db).load()).snapshot))
  } catch {
    console.error('CATALOG_UNAVAILABLE')
    return catalogFailure()
  }
}
export async function handleExpandedCatalog(request: Request, env: AuthEnv): Promise<Response> {
  if (!['GET', 'PUT'].includes(request.method)) return wrongMethod(request, 'GET, PUT')
  const auth = await requireAdmin(request, env)
  if (auth.error) return auth.error
  try {
    const repository = expandedRepository(env.DELEGAS_DB, auth)
    if (request.method === 'GET') {
      const result = await repository.load()
      return result.authorized
        ? authJson(result.snapshot, 200, { ETag: `"${result.snapshot.revision}"` })
        : authError('UNAUTHENTICATED', 401)
    }
    const header = request.headers.get('if-match')
    if (header === null)
      return authJson(
        { error: { code: 'PRECONDITION_REQUIRED', message: 'Informe If-Match.' } },
        428,
      )
    const revision = parseIfMatch(header)
    if (revision === null) return invalid({ ifMatch: 'Informe uma ETag forte única.' })
    const body = await readPatchBody(request, EXPANSION_LIMITS.bytes)
    if (!body) return authError('INVALID_REQUEST', 400)
    const parsed = validateExpanded(body.value, revisionToken(revision))
    if (parsed.fields) return invalid(parsed.fields)
    const result = await repository.save(parsed.value, revision)
    if (result.status === 'unauthorized' || !result.authorized)
      return authError('UNAUTHENTICATED', 401)
    if (result.status === 'conflict')
      return authJson(
        { error: { code: 'CATALOG_CONFLICT', message: 'Recarregue o catálogo antes de salvar.' } },
        409,
      )
    return authJson(
      {
        catalog: result.snapshot,
        created: {
          items: parsed.value.items
            .filter((i) => i.isNew)
            .map((i) => ({ clientId: i.creationRef, id: i.id })),
          variants: parsed.value.variants
            .filter((v) => v.isNew)
            .map((v) => ({ itemId: v.itemId, clientId: v.creationRef, code: v.code })),
        },
      },
      200,
      { ETag: `"${result.snapshot.revision}"` },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/\bCATALOG_(IDENTITY|RULE)\b/.test(message))
      return invalid({
        catalog:
          'Preserve todas as identidades e variantes; referências de criação não podem ser reutilizadas.',
      })
    if (/\bCATALOG_UNAUTHORIZED\b/.test(message)) return authError('UNAUTHENTICATED', 401)
    console.error('ADMIN_CATALOG_V2_UNAVAILABLE')
    return catalogFailure()
  }
}
