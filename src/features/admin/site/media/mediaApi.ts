import { cmsMediaId, cmsUuid, exact } from '../../../../../shared/cms/primitives'
import { type MediaProfile, mediaPath } from '../../mediaPath'
import { errorCode, send } from '../cmsCommands'

export { type MediaProfile, mediaPath }

/**
 * Cliente da biblioteca de mídia (M2B). Reutiliza só os endpoints que já existem:
 * `GET /api/admin/media`, `POST /api/admin/media`, `GET /api/admin/media/commands/:id` e a entrega
 * `GET /api/admin/media/:id/:profile`. Garantias desta camada:
 * - uma chamada, uma requisição: nunca reenvia por conta própria (quem decide é a tela);
 * - respostas são validadas por formato; o que não bate vira falha, nunca um item "meio válido";
 * - nada aqui conhece chave de armazenamento, hash ou manifesto: o servidor não os devolve.
 */

export type MediaState =
  | 'quarantined'
  | 'processing'
  | 'ready'
  | 'rejected'
  | 'deleting'
  | 'deleted'
export type MediaItem = {
  id: string
  state: MediaState
  revision: string
  profiles: MediaProfile[]
  /** `not_checked`: a listagem não lê o armazenamento; só a entrega do arquivo prova a disponibilidade. */
  integrity: 'not_checked' | 'unavailable'
}
export type MediaCapacity = {
  limit: number
  consumed: number
  remaining: number
  includesTombstones: boolean
}
export type MediaPage = { media: MediaItem[]; nextCursor: string | null; capacity: MediaCapacity }

export type MediaFailure =
  /** 401: sessão inválida. */
  | { kind: 'expired' }
  /** 403: origem recusada pela proteção do servidor. */
  | { kind: 'forbidden' }
  /** 404: este ambiente não tem biblioteca de imagens (só o laboratório local tem). */
  | { kind: 'unsupported' }
  /** 400/412/428: pedido ou arquivo recusado. Nada utilizável foi criado. */
  | { kind: 'invalid'; code?: string }
  /** 413: arquivo acima do limite. */
  | { kind: 'too-large' }
  /** 429: a capacidade disponível acabou. */
  | { kind: 'quota' }
  /** 409: outro envio em andamento ou conflito de operação. */
  | { kind: 'busy' }
  /** O envio terminou, mas o servidor registrou a operação como falha. */
  | { kind: 'failed-record' }
  /** Rede, tempo esgotado, 5xx ou resposta ilegível: uma escrita PODE ter acontecido. */
  | { kind: 'unknown' }

export type MediaOutcome<T> = { ok: true; value: T } | { ok: false; failure: MediaFailure }

export type UploadReceipt = {
  media: Omit<MediaItem, 'integrity'>
  operation: { id: string; status: 'done' | 'failed' }
}
export type ReceiptLookup =
  | { kind: 'receipt'; receipt: UploadReceipt }
  /** A operação ainda consta como em andamento: nada de reenviar. */
  | { kind: 'running'; reconciliationRequired: boolean }
  /** Nenhum registro encontrado. Não prova que nada foi gravado, mas autoriza repetir a MESMA operação. */
  | { kind: 'absent' }

const STATES: readonly MediaState[] = [
  'quarantined',
  'processing',
  'ready',
  'rejected',
  'deleting',
  'deleted',
]
const PROFILES: readonly MediaProfile[] = ['hero', 'section']
const LIST_TIMEOUT_MS = 15000
// O servidor limita o processamento a 5 s por imagem; sobra folga para a leitura do corpo.
const UPLOAD_TIMEOUT_MS = 40000

const isState = (value: unknown): value is MediaState => STATES.includes(value as MediaState)
const isProfile = (value: unknown): value is MediaProfile =>
  PROFILES.includes(value as MediaProfile)
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

function readItemCore(value: unknown, keys: string[]): Omit<MediaItem, 'integrity'> {
  if (
    !exact(value, keys) ||
    !cmsMediaId(value.id) ||
    !isState(value.state) ||
    typeof value.revision !== 'string' ||
    value.revision.length === 0 ||
    value.revision.length > 64 ||
    !Array.isArray(value.profiles) ||
    !value.profiles.every(isProfile) ||
    new Set(value.profiles).size !== value.profiles.length ||
    // Só mídia pronta tem perfis: um perfil em outro estado seria uma imagem que não existe.
    (value.state === 'ready') !== (value.profiles.length === PROFILES.length)
  )
    throw new Error('INVALID_MEDIA')
  return {
    id: value.id,
    state: value.state,
    revision: value.revision,
    profiles: value.profiles as MediaProfile[],
  }
}

export function readMediaPage(value: unknown): MediaPage {
  if (!exact(value, ['media', 'nextCursor', 'capacity']) || !Array.isArray(value.media))
    throw new Error('INVALID_MEDIA_PAGE')
  const { capacity, nextCursor } = value
  if (
    !exact(capacity, ['limit', 'consumed', 'remaining', 'includesTombstones']) ||
    !isCount(capacity.limit) ||
    !isCount(capacity.consumed) ||
    !isCount(capacity.remaining) ||
    capacity.limit === 0 ||
    typeof capacity.includesTombstones !== 'boolean' ||
    capacity.remaining !== Math.max(0, capacity.limit - capacity.consumed) ||
    (nextCursor !== null && (typeof nextCursor !== 'string' || nextCursor.length > 80))
  )
    throw new Error('INVALID_MEDIA_PAGE')
  const media = value.media.map((item): MediaItem => {
    if (!exact(item, ['id', 'state', 'revision', 'profiles', 'integrity']))
      throw new Error('INVALID_MEDIA')
    const core = readItemCore(
      { id: item.id, state: item.state, revision: item.revision, profiles: item.profiles },
      ['id', 'state', 'revision', 'profiles'],
    )
    if (item.integrity !== 'not_checked' && item.integrity !== 'unavailable')
      throw new Error('INVALID_MEDIA')
    return { ...core, integrity: item.integrity }
  })
  if (new Set(media.map((m) => m.id)).size !== media.length) throw new Error('INVALID_MEDIA_PAGE')
  return {
    media,
    nextCursor,
    capacity: {
      limit: capacity.limit,
      consumed: capacity.consumed,
      remaining: capacity.remaining,
      includesTombstones: capacity.includesTombstones,
    },
  }
}

export function readUploadReceipt(value: unknown): UploadReceipt {
  if (!exact(value, ['media', 'operation'])) throw new Error('INVALID_RECEIPT')
  const { media, operation } = value
  if (
    !exact(operation, ['id', 'status']) ||
    !cmsUuid(operation.id) ||
    (operation.status !== 'done' && operation.status !== 'failed')
  )
    throw new Error('INVALID_RECEIPT')
  return {
    media: readItemCore(media, ['id', 'state', 'revision', 'profiles']),
    operation: { id: operation.id, status: operation.status },
  }
}

/** Traduz status e código do servidor para o que a tela precisa decidir. */
export function classify(status: number, body: unknown): MediaFailure {
  const code = errorCode(body)
  if (status === 401) return { kind: 'expired' }
  if (status === 403) return { kind: 'forbidden' }
  if (status === 404) return { kind: 'unsupported' }
  if (status === 413) return { kind: 'too-large' }
  if (status === 429) return { kind: 'quota' }
  if (status === 409) return { kind: 'busy' }
  if (status === 400 || status === 412 || status === 428) return { kind: 'invalid', code }
  // 408 e 5xx: o servidor pode ter começado a gravar.
  return { kind: 'unknown' }
}

/** Uma página da biblioteca (somente leitura). `cursor` é o que o servidor devolveu antes. */
export async function listMedia(
  { cursor, limit }: { cursor?: string | null; limit: number },
  signal?: AbortSignal,
): Promise<MediaOutcome<MediaPage>> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursor) query.set('cursor', cursor)
  try {
    const { status, body } = await send(
      `/api/admin/media?${query}`,
      { method: 'GET', signal },
      LIST_TIMEOUT_MS,
    )
    if (status !== 200) return { ok: false, failure: classify(status, body) }
    return { ok: true, value: readMediaPage(body) }
  } catch {
    return { ok: false, failure: { kind: 'unknown' } }
  }
}

/**
 * Envia uma imagem. Uma tentativa só: o `operationId` é a identidade da operação no servidor, e repetir o
 * mesmo envio (mesmo ID, mesmos bytes) é idempotente. Quem chama decide se e quando repetir.
 */
export async function uploadMedia(input: {
  file: Blob
  mime: string
  operationId: string
}): Promise<MediaOutcome<UploadReceipt>> {
  try {
    const { status, body } = await send(
      '/api/admin/media',
      {
        method: 'POST',
        headers: {
          'Content-Type': input.mime,
          'X-Operation-Id': input.operationId,
          'If-None-Match': '*',
        },
        body: input.file,
      },
      UPLOAD_TIMEOUT_MS,
    )
    if (status !== 200) return { ok: false, failure: classify(status, body) }
    const receipt = readUploadReceipt(body)
    return receipt.operation.status === 'done'
      ? { ok: true, value: receipt }
      : { ok: false, failure: { kind: 'failed-record' } }
  } catch {
    return { ok: false, failure: { kind: 'unknown' } }
  }
}

/** Consulta o recibo de uma operação de envio. Somente leitura; nunca cria nem reenvia nada. */
export async function fetchUploadReceipt(
  operationId: string,
): Promise<MediaOutcome<ReceiptLookup>> {
  try {
    const { status, body } = await send(
      `/api/admin/media/commands/${operationId}`,
      { method: 'GET' },
      LIST_TIMEOUT_MS,
    )
    if (status === 404) {
      // 404 do CMS sem o código da operação = ambiente sem biblioteca.
      return errorCode(body) === 'MEDIA_OPERATION_NOT_FOUND'
        ? { ok: true, value: { kind: 'absent' } }
        : { ok: false, failure: { kind: 'unsupported' } }
    }
    if (status === 202) {
      const running =
        exact(body, ['operation', 'outcome']) &&
        exact(body.operation, ['id', 'status', 'reconciliationRequired'])
          ? body.operation
          : null
      const required = running?.reconciliationRequired
      if (running?.status !== 'running' || typeof required !== 'boolean')
        return { ok: false, failure: { kind: 'unknown' } }
      return { ok: true, value: { kind: 'running', reconciliationRequired: required } }
    }
    if (status !== 200) return { ok: false, failure: classify(status, body) }
    const receipt = readUploadReceipt(body)
    return receipt.operation.id === operationId
      ? { ok: true, value: { kind: 'receipt', receipt } }
      : { ok: false, failure: { kind: 'unknown' } }
  } catch {
    return { ok: false, failure: { kind: 'unknown' } }
  }
}
