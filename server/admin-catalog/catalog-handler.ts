import { requireAdmin } from '../auth/guard'
import { type AuthEnv, authError, authJson, wrongMethod } from '../auth/http'
import {
  CATALOG_BODY_LIMIT,
  parseIfMatch,
  revisionToken,
  validateCatalog,
} from './catalog-contract'
import { createCatalogRepository } from './catalog-repository'
import { readPatchBody } from './validation'

const validationError = (fields: Record<string, string>) =>
  authJson({ error: { code: 'VALIDATION_ERROR', message: 'Catálogo inválido.', fields } }, 400)

export async function handleCatalog(request: Request, env: AuthEnv): Promise<Response> {
  if (!['GET', 'PUT'].includes(request.method)) return wrongMethod(request, 'GET, PUT')
  const authorization = await requireAdmin(request, env)
  if (authorization.error) return authorization.error
  try {
    const repository = createCatalogRepository(env.DELEGAS_DB, authorization)
    if (request.method === 'GET') {
      const result = await repository.load()
      return result.authorized
        ? authJson(result.snapshot, 200, { ETag: `"${result.snapshot.revision}"` })
        : authError('UNAUTHENTICATED', 401)
    }
    const header = request.headers.get('if-match')
    if (header === null)
      return authJson(
        {
          error: { code: 'PRECONDITION_REQUIRED', message: 'Informe a revisão base em If-Match.' },
        },
        428,
      )
    const revision = parseIfMatch(header)
    if (revision === null)
      return validationError({
        ifMatch: 'Use uma única ETag forte no formato "r0", sem listas, wildcard ou prefixo fraco.',
      })
    const body = await readPatchBody(request, CATALOG_BODY_LIMIT)
    if (!body) return authError('INVALID_REQUEST', 400)
    const input = validateCatalog(body.value, revisionToken(revision))
    if (input.fields) return validationError(input.fields)
    const result = await repository.save(input.value, revision)
    if (result.status === 'unauthorized') return authError('UNAUTHENTICATED', 401)
    if (result.status === 'conflict')
      return authJson(
        {
          error: {
            code: 'CATALOG_CONFLICT',
            message: 'O catálogo mudou. Recarregue antes de salvar.',
          },
        },
        409,
      )
    return authJson(result.snapshot, 200, { ETag: `"${result.snapshot.revision}"` })
  } catch (error) {
    if (error instanceof Error && /\bCATALOG_IDS_INVALID\b/.test(error.message))
      return validationError({
        catalog:
          'Os IDs devem corresponder exatamente aos registros existentes, sem criação ou exclusão.',
      })
    console.error('ADMIN_CATALOG_UNAVAILABLE')
    return authJson(
      {
        error: {
          code: 'ADMIN_CATALOG_UNAVAILABLE',
          message: 'Catálogo administrativo indisponível no momento.',
        },
      },
      503,
    )
  }
}
