import { requireAdmin } from '../auth/guard'
import { type AuthEnv, authError, authJson, wrongMethod } from '../auth/http'
import { parseCmsConversion } from './commands'
import { readCmsBody } from './http'
import { cmsRevision, cmsUuid } from './primitives'
import { cmsRepository } from './repository'
import { parseCmsMutation } from './validation-v2'

const errorJson = (code: string, message: string, status: number) =>
  authJson({ error: { code, message } }, status)
function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  if (/\bCMS_UNAUTHORIZED\b/.test(message)) return authError('UNAUTHENTICATED', 401)
  if (/FOREIGN KEY constraint failed/i.test(message))
    return errorJson('CMS_INVALID_MEDIA', 'Referência de mídia indisponível.', 400)
  const statuses: Record<string, number> = {
    CMS_SCHEMA_UNSUPPORTED: 400,
    CMS_INVALID_ITEM: 400,
    CMS_MEDIA_UNAVAILABLE: 400,
    CMS_INVALID_MEDIA: 400,
    CMS_SCHEMA_MISMATCH: 409,
    CMS_SCHEMA_SUPERSEDED: 409,
    CMS_ALREADY_V2: 409,
    CMS_REVISION_CONFLICT: 409,
    CMS_OPERATION_CONFLICT: 409,
    CMS_ACKNOWLEDGEMENT_REQUIRED: 409,
    CMS_SCHEMA_UNAVAILABLE: 503,
    CMS_WRITE_INCOMPLETE: 503,
    CMS_PUBLICATION_DISABLED: 400,
  }
  const code = message.match(/\bCMS_[A-Z0-9_]+\b/)?.[0]
  if (code && Object.hasOwn(statuses, code))
    return errorJson(
      code === 'CMS_MEDIA_UNAVAILABLE' ? 'CMS_INVALID_MEDIA' : code,
      'Operação CMS recusada. Recarregue o estado antes de tentar novamente.',
      statuses[code],
    )
  console.error('ADMIN_CMS_UNAVAILABLE')
  return errorJson('CMS_UNAVAILABLE', 'CMS indisponível no momento.', 503)
}
async function mutationInput(request: Request) {
  const match = request.headers.get('if-match')
  if (match === null) return { error: errorJson('PRECONDITION_REQUIRED', 'Informe If-Match.', 428) }
  const revision = match.startsWith('"') && match.endsWith('"') ? match.slice(1, -1) : null
  if (!cmsRevision(revision)) return { error: authError('INVALID_REQUEST', 400) }
  const body = await readCmsBody(request)
  if (body.error)
    return {
      error: errorJson(
        body.error,
        'Corpo CMS inválido ou leitura excedida.',
        body.error === 'BODY_TOO_LARGE' ? 413 : body.error === 'READ_TIMEOUT' ? 408 : 400,
      ),
    }
  return { value: body.value, revision }
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
  const input = await mutationInput(request)
  if (input.error) return input.error
  const parsed = parseCmsMutation(input.value)
  if (parsed.value?.action !== 'saveDraft' || parsed.value.expectedRevision !== input.revision)
    return authJson(
      {
        error: {
          code: parsed.code ?? 'VALIDATION_ERROR',
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
export async function handleCmsConvert(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== 'POST') return wrongMethod(request, 'POST')
  const auth = await requireAdmin(request, env)
  if (auth.error) return auth.error
  const input = await mutationInput(request)
  if (input.error) return input.error
  const parsed = parseCmsConversion(input.value)
  if (!parsed.value || parsed.value.expectedRevision !== input.revision)
    return authJson(
      {
        error: {
          code: parsed.code ?? 'VALIDATION_ERROR',
          message: 'Comando CMS inválido.',
          fields: parsed.fields ?? { conversion: 'Revisão deve ser igual a If-Match.' },
        },
      },
      400,
    )
  try {
    const repo = cmsRepository(env.DELEGAS_DB, auth),
      command = parsed.value
    if (command.action === 'previewConversion')
      return authJson(await repo.previewConversion(command))
    const result =
      command.action === 'startV2' ? await repo.startV2(command) : await repo.convertToV2(command)
    if (!('command' in result)) throw Error('CMS_WRITE_INCOMPLETE')
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
