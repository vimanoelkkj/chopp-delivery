import { requireAdmin } from '../auth/guard'
import { type AuthEnv, authError, authJson, wrongMethod } from '../auth/http'
import type { AdminCachaca, AdminProduct, CatalogResource, MutationResult } from './contracts'
import { createAdminCatalogRepository } from './repository'
import {
  containsControls,
  readPatchBody,
  unsafeUnicode,
  validateCachacaPatch,
  validateProductPatch,
} from './validation'

function invalid(fields: Record<string, string>): Response {
  return authJson({ error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', fields } }, 400)
}

function unavailable(): Response {
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

export async function handleAdminList(
  request: Request,
  env: AuthEnv,
  resource: CatalogResource,
): Promise<Response> {
  if (request.method !== 'GET') return wrongMethod(request, 'GET')
  const authorization = await requireAdmin(request, env)
  if (authorization.error) return authorization.error
  try {
    const repository = createAdminCatalogRepository(env.DELEGAS_DB, authorization)
    const result =
      resource === 'products' ? await repository.listProducts() : await repository.listCachacas()
    if (!result.authorized) return authError('UNAUTHENTICATED', 401)
    return authJson({ [resource]: result.items })
  } catch {
    return unavailable()
  }
}

export async function handleAdminPatch(
  request: Request,
  env: AuthEnv,
  resource: CatalogResource,
  id: unknown,
): Promise<Response> {
  if (request.method !== 'PATCH') return wrongMethod(request, 'PATCH')
  const authorization = await requireAdmin(request, env)
  if (authorization.error) return authorization.error
  if (
    typeof id !== 'string' ||
    !id.length ||
    id.length > 128 ||
    containsControls(id) ||
    unsafeUnicode(id)
  )
    return invalid({ id: 'Use um identificador string válido.' })
  try {
    const body = await readPatchBody(request)
    if (!body) return authError('INVALID_REQUEST', 400)
    const repository = createAdminCatalogRepository(env.DELEGAS_DB, authorization)
    let result: MutationResult<AdminProduct | AdminCachaca>
    if (resource === 'products') {
      const input = validateProductPatch(body.value)
      if (input.fields) return invalid(input.fields)
      result = await repository.updateProduct(id, input.value)
    } else {
      const input = validateCachacaPatch(body.value)
      if (input.fields) return invalid(input.fields)
      result = await repository.updateCachaca(id, input.value)
    }
    if (result.status === 'unauthorized') return authError('UNAUTHENTICATED', 401)
    if (result.status === 'invalid') return invalid(result.fields)
    if (result.status === 'missing')
      return authJson({ error: { code: 'NOT_FOUND', message: 'Registro não encontrado.' } }, 404)
    return authJson({
      [resource === 'products' ? 'product' : 'cachaca']: result.item,
      changed: result.changed,
    })
  } catch {
    return unavailable()
  }
}
