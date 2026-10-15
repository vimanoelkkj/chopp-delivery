import type { AdminCatalog, SaveInput, SaveResult } from './types'

export type AdminApiErrorCode =
  | 'unauthenticated'
  /** O catálogo mudou depois do `revision` em que a edição se baseou (HTTP 409 na F3A). */
  | 'conflict'
  | 'rejected'
  /** Origem/CSRF recusada (HTTP 403): a requisição não chegou a gravar nada. */
  | 'forbidden'
  | 'unavailable'

export class AdminApiError extends Error {
  constructor(readonly code: AdminApiErrorCode) {
    super(code)
  }
}

/**
 * Fronteira com o backend administrativo. A F3B usa `createMockGateway`; a integração da
 * F3A.2 implementa esta interface sem tocar nos componentes. Erros devem ser `AdminApiError`.
 */
export type AdminCatalogGateway = {
  load(signal?: AbortSignal): Promise<AdminCatalog>
  /**
   * Persiste o catálogo inteiro (ordem dos arrays = ordem de exibição) e devolve o snapshot salvo
   * com `revision` nova, mais os mapas clientId → id/code definitivos. `input.revision` é a
   * revisão base: se o servidor estiver em outra, recusa com `AdminApiError('conflict')` sem
   * gravar nada. Nunca sobrescrever em silêncio. Um clientId já persistido que reapareça como
   * novo é recusado (`rejected`), nunca vira outra linha.
   */
  save(input: SaveInput): Promise<SaveResult>
}
