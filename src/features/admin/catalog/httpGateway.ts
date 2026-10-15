import { AdminApiError, type AdminCatalogGateway } from './gateway'
import { parseSaveResult, parseSnapshot } from './wire'

/**
 * Adaptador HTTP do `AdminCatalogGateway` para a API v2 do catálogo (F3A.2).
 *
 * **CONTRATO PROVISÓRIO** (de `tasks/plan.md`, branch `feat/catalog-expansion`): a rota, os
 * nomes de campos e os status abaixo podem mudar. NADA aqui é usado pelo painel hoje: o
 * `AdminApp` continua com o mock até a integração. Para ligar, ver "Passos para conectar" em
 * `docs/admin-panel-handoff.md`. Nenhuma chamada é feita na construção do gateway.
 *
 * Mapeamento de erros → `AdminApiError`:
 *   401 → unauthenticated | 409 → conflict | 400/403/410/428 → rejected
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
  if ([400, 403, 410, 428].includes(status)) return new AdminApiError('rejected')
  return new AdminApiError('unavailable')
}

export function createHttpGateway({
  fetch: fetcher = (...args) => fetch(...args),
  path = CATALOG_V2_PATH,
}: Options = {}): AdminCatalogGateway {
  async function call(init: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await fetcher(path, { credentials: 'same-origin', ...init })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new AdminApiError('unavailable')
    }
    if (!response.ok) throw fail(response.status)
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
