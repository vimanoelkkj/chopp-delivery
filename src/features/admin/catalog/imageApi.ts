import { requireApiJson } from '../httpResponse'

/**
 * Imagem principal de um produto (F4A.6.4E): cliente de `/api/admin/catalog/media`. Revisão própria
 * (`mN`), independente da revisão do catálogo (`rN`): trocar a imagem nunca mexe em preços nem
 * variantes. Só existe nas versões com a API HTTP real (release e admin-integration).
 */
export const PRODUCT_IMAGES_ENABLED =
  import.meta.env.MODE === 'release' || import.meta.env.MODE === 'admin-integration'

const BASE = '/api/admin/catalog/media'

export type ImageState = {
  itemId: string
  mediaId: string | null
  alt: string | null
  revision: number
}

export type ImageErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  /** Outra sessão alterou a imagem depois do que esta tela leu. Nada foi gravado. */
  | 'conflict'
  /** O servidor recusou os dados (mídia fora do ar, não pronta, alt inválido). */
  | 'invalid'
  | 'not-found'
  | 'no-image'
  /** Gate de mídia fechado neste ambiente: leitura funciona, escrita não. */
  | 'disabled'
  /** Migration ausente, D1 indisponível, rede. */
  | 'unavailable'

export class ImageApiError extends Error {
  constructor(
    readonly code: ImageErrorCode,
    readonly detail?: string,
  ) {
    super(code)
  }
}

function parseState(value: unknown): ImageState {
  if (typeof value !== 'object' || value === null) throw new Error('INVALID_IMAGE_STATE')
  const { itemId, mediaId, alt, revision } = value as Record<string, unknown>
  const match = typeof revision === 'string' ? /^m(0|[1-9][0-9]{0,15})$/.exec(revision) : null
  if (
    typeof itemId !== 'string' ||
    !match ||
    !(mediaId === null || typeof mediaId === 'string') ||
    !(alt === null || typeof alt === 'string') ||
    (mediaId === null) !== (alt === null)
  )
    throw new Error('INVALID_IMAGE_STATE')
  return { itemId, mediaId, alt, revision: Number(match[1]) }
}

function classify(status: number, body: unknown): ImageApiError {
  const error = (body as { error?: { code?: unknown; fields?: unknown } } | null)?.error
  const code = typeof error?.code === 'string' ? error.code : ''
  if (status === 401) return new ImageApiError('unauthenticated')
  if (status === 403) return new ImageApiError('forbidden')
  if (status === 409) return new ImageApiError('conflict')
  if (status === 404) {
    if (code === 'ITEM_NOT_FOUND') return new ImageApiError('not-found')
    if (code === 'IMAGE_NOT_FOUND') return new ImageApiError('no-image')
    return new ImageApiError('disabled')
  }
  if (status === 400 || status === 428) {
    const fields = error?.fields
    const first =
      typeof fields === 'object' && fields !== null
        ? Object.values(fields).find((v): v is string => typeof v === 'string' && v.length <= 200)
        : undefined
    return new ImageApiError('invalid', first)
  }
  return new ImageApiError('unavailable', code)
}

async function call(path: string, init: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, { credentials: 'same-origin', redirect: 'error', ...init })
    requireApiJson(response)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ImageApiError('unavailable')
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    if (response.ok) throw new ImageApiError('unavailable')
  }
  if (!response.ok) throw classify(response.status, body)
  return body
}

const token = (revision: number) => JSON.stringify(`m${revision}`)

export const productImages = {
  async get(itemId: string, signal?: AbortSignal): Promise<ImageState> {
    const body = await call(`${BASE}/${encodeURIComponent(itemId)}`, { method: 'GET', signal })
    try {
      return parseState(body)
    } catch {
      throw new ImageApiError('unavailable')
    }
  },
  async put(
    itemId: string,
    revision: number,
    media: { mediaId: string; alt: string },
  ): Promise<ImageState> {
    const body = await call(`${BASE}/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': token(revision) },
      body: JSON.stringify(media),
    })
    try {
      return parseState(body)
    } catch {
      // Resposta ilegível depois de gravar: o desfecho é incerto, a tela relê antes de agir.
      throw new ImageApiError('unavailable')
    }
  },
  async remove(itemId: string, revision: number): Promise<ImageState> {
    const body = await call(`${BASE}/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      headers: { 'If-Match': token(revision) },
    })
    try {
      return parseState(body)
    } catch {
      throw new ImageApiError('unavailable')
    }
  },
}
