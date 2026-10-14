import type { AdminCatalog } from './types'

export type AdminApiErrorCode =
  | 'unauthenticated'
  /** O catálogo mudou depois do `revision` em que a edição se baseou (HTTP 409/412 na F3A). */
  | 'conflict'
  | 'rejected'
  | 'unavailable'

export class AdminApiError extends Error {
  constructor(readonly code: AdminApiErrorCode) {
    super(code)
  }
}

/**
 * Fronteira com o backend administrativo. A F3B usa `createMockGateway`; a integração da
 * F3A implementa esta interface sem tocar nos componentes. Erros devem ser `AdminApiError`.
 */
export type AdminCatalogGateway = {
  load(signal?: AbortSignal): Promise<AdminCatalog>
  /**
   * Persiste o catálogo inteiro na ordem recebida e devolve o estado salvo, com `revision` nova.
   * `next.revision` é a revisão em que a edição se baseou: se o servidor já estiver em outra,
   * deve recusar com `AdminApiError('conflict')` sem gravar nada. Nunca sobrescrever em silêncio.
   */
  save(next: AdminCatalog): Promise<AdminCatalog>
}
