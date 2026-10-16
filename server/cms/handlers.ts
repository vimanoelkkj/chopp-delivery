import { requireAdmin } from '../auth/guard'
import { type AuthEnv, authError, authJson, wrongMethod } from '../auth/http'
import { readCmsBody } from './http'
import { cmsRepository } from './repository'
import { cmsRevision, cmsUuid, validateCmsMutation } from './validation'

const errorJson = (code: string, message: string, status: number) =>
  authJson({ error: { code, message } }, status)
function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  if (/\bCMS_UNAUTHORIZED\b/.test(message)) return authError('UNAUTHENTICATED', 401)
  if (/\bCMS_REVISION_CONFLICT\b/.test(message))
    return errorJson('CMS_REVISION_CONFLICT', 'Recarregue o estado do CMS antes de salvar.', 409)
  if (/\bCMS_OPERATION_CONFLICT\b/.test(message))
    return errorJson('CMS_OPERATION_CONFLICT', 'Identificador de comando já utilizado.', 409)
  if (/\bCMS_MEDIA_UNAVAILABLE\b|FOREIGN KEY constraint failed/i.test(message))
    return errorJson('CMS_INVALID_MEDIA', 'Referência de mídia indisponível.', 400)
  console.error('ADMIN_CMS_UNAVAILABLE')
  return errorJson('CMS_UNAVAILABLE', 'CMS indisponível no momento.', 503)
}
export async function handleCmsSite(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== 'GET') return wrongMethod(request, 'GET')
  const auth = await requireAdmin(request, env)
  if (auth.error) return auth.error
  try {
    const site = await cmsRepository(env.DELEGAS_DB, auth).load()
    return authJson(site, 200, { ETag: `"${site.draft.revision}"` })
  } catch (error) {
    return failure(error)
  }
}
export async function handleCmsDraft(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== 'PUT') return wrongMethod(request, 'PUT')
  const auth = await requireAdmin(request, env)
  if (auth.error) return auth.error
  const match = request.headers.get('if-match')
  if (match === null) return errorJson('PRECONDITION_REQUIRED', 'Informe If-Match.', 428)
  const revision = match.startsWith('"') && match.endsWith('"') ? match.slice(1, -1) : null
  if (!cmsRevision(revision)) return authError('INVALID_REQUEST', 400)
  const body = await readCmsBody(request)
  if (body.error)
    return errorJson(
      body.error,
      'Corpo CMS inválido ou leitura excedida.',
      body.error === 'BODY_TOO_LARGE' ? 413 : body.error === 'READ_TIMEOUT' ? 408 : 400,
    )
  const parsed = validateCmsMutation(body.value)
  if (parsed.value?.action !== 'saveDraft' || parsed.value.expectedRevision !== revision)
    return authJson(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Rascunho CMS inválido.',
          fields: parsed.fields ?? { mutation: 'Use saveDraft e revisão igual a If-Match.' },
        },
      },
      400,
    )
  try {
    const result = await cmsRepository(env.DELEGAS_DB, auth).save(parsed.value)
    return authJson(result, 200, { ETag: `"${result.command.revision}"` })
  } catch (error) {
    return failure(error)
  }
}
export async function handleCmsCommand(
  request: Request,
  env: AuthEnv,
  id: unknown,
): Promise<Response> {
  if (request.method !== 'GET') return wrongMethod(request, 'GET')
  const auth = await requireAdmin(request, env)
  if (auth.error) return auth.error
  if (!cmsUuid(id)) return authError('INVALID_REQUEST', 400)
  try {
    const result = await cmsRepository(env.DELEGAS_DB, auth).command(id)
    return result
      ? authJson(result, 200, { ETag: `"${result.command.revision}"` })
      : errorJson('CMS_COMMAND_NOT_FOUND', 'Comando não encontrado.', 404)
  } catch (error) {
    return failure(error)
  }
}
