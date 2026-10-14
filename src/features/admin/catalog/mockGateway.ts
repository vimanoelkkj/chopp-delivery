import { AdminApiError, type AdminCatalogGateway } from './gateway'
import { createMockCatalog } from './mockData'
import type { AdminCatalog } from './types'

/** Cenários do mock, escolhidos por `?mock=` na URL: servem à prévia e aos testes de interface. */
export type MockMode =
  | 'slow'
  | 'error'
  | 'empty'
  | 'save-error'
  | 'expired'
  | 'conflict'
  | undefined

const MODES = ['slow', 'error', 'empty', 'save-error', 'expired', 'conflict']

export function readMockMode(search: string): MockMode {
  const value = new URLSearchParams(search).get('mock')
  return MODES.includes(value ?? '') ? (value as MockMode) : undefined
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

export function createMockGateway(mode: MockMode = undefined, latency = 700): AdminCatalogGateway {
  let stored: AdminCatalog =
    mode === 'empty' ? { revision: '1', chopes: [], cachacas: [] } : createMockCatalog()
  let loads = 0
  let otherSessionSaved = false
  return {
    async load(signal) {
      await wait(mode === 'slow' ? 3500 : latency, signal)
      // O primeiro carregamento falha; "Tentar de novo" recupera.
      if (mode === 'error' && loads++ === 0) throw new AdminApiError('unavailable')
      return structuredClone(stored)
    },
    async save(next) {
      await wait(latency + 300)
      if (mode === 'save-error') throw new AdminApiError('unavailable')
      if (mode === 'expired') throw new AdminApiError('unauthenticated')
      if (mode === 'conflict' && !otherSessionSaved) {
        // Simula outra sessão salvando antes: o Dronken 30 L muda e a revisão avança.
        otherSessionSaved = true
        stored = structuredClone(stored)
        stored.chopes[0].prices['30'] = 53000
        stored.revision = String(Number(stored.revision) + 1)
      }
      // Mesma regra exigida do servidor real: base desatualizada não grava nada.
      if (next.revision !== stored.revision) throw new AdminApiError('conflict')
      stored = { ...structuredClone(next), revision: String(Number(stored.revision) + 1) }
      return structuredClone(stored)
    },
  }
}
