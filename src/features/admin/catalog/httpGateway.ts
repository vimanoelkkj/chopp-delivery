import { requireApiJson } from '../httpResponse'
import { AdminApiError, type AdminCatalogGateway } from './gateway'
import { parseSaveResult, parseSnapshot } from './wire'

/**
 * Adaptador HTTP do `AdminCatalogGateway` para a API v2 do catálogo (F3A.2).
 *
 * Ativo somente no modo local explícito admin-integration (F3C.2).
 * Sem fallback para mock. Nenhuma chamada ocorre na construção do gateway.
 *
 * Mapeamento de erros → `AdminApiError`:
 *   401 → unauthenticated | 409 → conflict | 403 → forbidden | 400/410/428 → rejected
 *   503, demais 5xx, falha de rede, JSON/forma inválidos → unavailable
 * `unavailable` num PUT significa **resultado incerto**: a escrita pode ter sido confirmada.
 */
export const CATALOG_V2_PATH = '/api/admin/catalog/v2'

type Options = {
  /** Injetável para testes; padrão: `fetch` global (cookie de sessão da F2, mesma origem). */
  fetch?: typeof fetch
  path?: string
}

function fail(status: number): AdminApiError {
  if (status === 401) return new AdminApiError('unauthenticated')
  if (status === 409) return new AdminApiError('conflict')
  if (status === 403) return new AdminApiError('forbidden')
  if ([400, 410, 428].includes(status)) return new AdminApiError('rejected')
  return new AdminApiError('unavailable')
}

/** Primeiro motivo de campo da recusa 400 do servidor (textos próprios, em português e curtos). */
async function failWithDetail(response: Response): Promise<AdminApiError> {
  const error = fail(response.status)
  if (response.status !== 400) return error
  try {
    const body: unknown = await response.json()
    const fields = (body as { error?: { fields?: unknown } })?.error?.fields
    if (typeof fields !== 'object' || fields === null) return error
    const first = Object.values(fields).find(
      (value): value is string =>
        typeof value === 'string' && value.length > 0 && value.length <= 200,
    )
    return first ? new AdminApiError('rejected', first) : error
  } catch {
    return error
  }
}

export function createHttpGateway({
  fetch: fetcher = (...args) => fetch(...args),
  path = CATALOG_V2_PATH,
}: Options = {}): AdminCatalogGateway {
  async function call(init: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await fetcher(path, { credentials: 'same-origin', ...init, redirect: 'error' })
      requireApiJson(response)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new AdminApiError('unavailable')
    }
    if (!response.ok) throw await failWithDetail(response)
    try {
      return await response.json()
    } catch {
      throw new AdminApiError('unavailable')
    }
  }

  return {
    async load(signal) {
      const body = await call({ method: 'GET', signal })
      try {
        return parseSnapshot(body)
      } catch {
        throw new AdminApiError('unavailable')
      }
    },
    async save(input) {
      const body = await call({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': JSON.stringify(input.revision) },
        body: JSON.stringify(input),
      })
      try {
        return parseSaveResult(body)
      } catch {
        // A resposta chegou mas não é um snapshot confiável: a escrita pode ter acontecido.
        throw new AdminApiError('unavailable')
      }
    },
  }
}
