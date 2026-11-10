import { cmsMediaId, text } from '../../shared/cms/primitives'
import { readPatchBody } from '../admin-catalog/validation'
import { requireAdmin } from '../auth/guard'
import { authError, authJson, wrongMethod } from '../auth/http'
import { validId } from '../catalog-expansion/validation'
import { type LocalMediaEnv, localMediaEnabled } from '../cms/media-library'
import {
  type Association,
  catalogMediaReady,
  catalogMediaRepository,
  parseRevision,
  revisionToken,
} from './repository'

const BODY_LIMIT = 4096

const present = (association: Association) => ({
  itemId: association.itemId,
  mediaId: association.mediaId,
  alt: association.alt,
  revision: revisionToken(association.revision),
})
const etag = (association: Association) => ({ ETag: `"${revisionToken(association.revision)}"` })
const invalid = (fields: Record<string, string>) =>
  authJson({ error: { code: 'VALIDATION_ERROR', message: 'Imagem inválida.', fields } }, 400)
const failure = (code: string, message: string, status: number) =>
  authJson({ error: { code, message } }, status)
const conflict = () =>
  failure(
    'CATALOG_MEDIA_CONFLICT',
    'A imagem deste produto mudou. Recarregue antes de salvar.',
    409,
  )

/**
 * Imagem principal de um produto: `GET /api/admin/catalog/media` (lista) e
 * `GET|PUT|DELETE /api/admin/catalog/media/{itemId}`. Fora de `/api/admin/catalog/v2`, que não muda.
 * Escrita só com o gate de mídia aberto; leitura administrativa não depende dele.
 */
export async function handleCatalogMedia(
  request: Request,
  env: LocalMediaEnv,
  itemId?: string,
): Promise<Response> {
  const allowed = itemId === undefined ? 'GET' : 'GET, PUT, DELETE'
  if (!allowed.split(', ').includes(request.method)) return wrongMethod(request, allowed)
  const writing = request.method === 'PUT' || request.method === 'DELETE'
  if (writing && !localMediaEnabled(request, env)) return authError('NOT_FOUND', 404)
  const auth = await requireAdmin(request, env)
  if (auth.error) return auth.error
  if (itemId !== undefined && !validId(itemId)) return authError('INVALID_REQUEST', 400)
  try {
    if (!(await catalogMediaReady(env.DELEGAS_DB)))
      return failure(
        'CATALOG_MEDIA_UNAVAILABLE',
        'Imagens de produto indisponíveis neste ambiente.',
        503,
      )
    const repository = catalogMediaRepository(env.DELEGAS_DB, auth)
    if (itemId === undefined)
      return authJson({ associations: (await repository.list()).map(present) })
    const current = await repository.get(itemId)
    if (!current) return failure('ITEM_NOT_FOUND', 'Produto não encontrado.', 404)
    if (request.method === 'GET') return authJson(present(current), 200, etag(current))

    const header = request.headers.get('if-match')
    if (header === null)
      return failure('PRECONDITION_REQUIRED', 'Informe a revisão da imagem em If-Match.', 428)
    const expected = parseRevision(header)
    if (expected === null)
      return invalid({
        ifMatch: 'Use uma única ETag forte no formato "m0", sem lista nem wildcard.',
      })

    let media: { mediaId: string; alt: string } | null = null
    if (request.method === 'PUT') {
      const body = await readPatchBody(request, BODY_LIMIT)
      if (!body) return authError('INVALID_REQUEST', 400)
      const value = body.value as Record<string, unknown> | null
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'alt,mediaId'
      )
        return invalid({ body: 'Informe somente mediaId e alt.' })
      const fields: Record<string, string> = {}
      if (!cmsMediaId(value.mediaId)) fields.mediaId = 'Identificador de imagem inválido.'
      if (!text(value.alt, 200, true) || (value.alt as string).trim() === '')
        fields.alt = 'Descreva a imagem em até 200 caracteres, sem caracteres de controle.'
      if (Object.keys(fields).length) return invalid(fields)
      media = { mediaId: value.mediaId as string, alt: value.alt as string }
      if ((await repository.mediaState(media.mediaId)) !== 'ready')
        return invalid({ mediaId: 'A imagem escolhida não existe ou ainda não está pronta.' })
      // Idempotente: mesma imagem e mesmo alt na revisão atual não geram revisão nova.
      if (
        expected === current.revision &&
        current.mediaId === media.mediaId &&
        current.alt === media.alt
      )
        return authJson(present(current), 200, etag(current))
    } else if (current.mediaId === null) {
      return expected === current.revision
        ? failure('IMAGE_NOT_FOUND', 'Este produto não tem imagem associada.', 404)
        : conflict()
    }

    const result = await repository.write(itemId, expected, media)
    if (result.status === 'unauthorized') return authError('UNAUTHENTICATED', 401)
    if (result.status === 'conflict' || !result.association) return conflict()
    return authJson(present(result.association), 200, etag(result.association))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/CATALOG_UNAUTHORIZED/.test(message)) return authError('UNAUTHENTICATED', 401)
    if (/CATALOG_MEDIA_NOT_READY|FOREIGN KEY/.test(message))
      return invalid({ mediaId: 'A imagem escolhida não existe ou ainda não está pronta.' })
    console.error('CATALOG_MEDIA_UNAVAILABLE')
    return failure('CATALOG_MEDIA_UNAVAILABLE', 'Imagem do produto indisponível no momento.', 503)
  }
}
