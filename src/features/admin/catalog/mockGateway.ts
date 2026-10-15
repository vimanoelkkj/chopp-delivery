import { AdminApiError, type AdminCatalogGateway } from './gateway'
import { createMockCatalog } from './mockData'
import type { AdminCatalog, AdminItem, AdminVariant, ItemInput, SaveResult } from './types'

/** Cenários do mock, escolhidos por `?mock=` na URL: servem à prévia e aos testes de interface. */
export type MockMode =
  | 'slow'
  | 'error'
  | 'empty'
  | 'save-error'
  | 'expired'
  | 'conflict'
  | 'lost-response'
  | undefined

const MODES = ['slow', 'error', 'empty', 'save-error', 'expired', 'conflict', 'lost-response']

/**
 * Os cenários `?mock=` só existem no `vite dev` e no build de E2E (`vite build --mode e2e`).
 * O build publicável (`vite build`) os ignora: a URL não liga nenhum comportamento de teste.
 */
const SCENARIOS = import.meta.env.DEV || import.meta.env.MODE === 'e2e'

export function readMockMode(search: string): MockMode {
  if (!SCENARIOS) return undefined
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

const has = <K extends string>(value: object, key: K): value is Record<K, string> => key in value

/** Aplica o PUT como o servidor real deve: tudo ou nada, sem criar/excluir por omissão. */
function apply(stored: AdminCatalog, input: ItemInput[][], result: SaveResult['created']) {
  const next = structuredClone(stored)
  const knownRefs = new Set<string>(
    next.categories.flatMap((c) =>
      c.items.flatMap((i) => [i.creationRef, ...i.variants.map((v) => v.creationRef)]),
    ) as string[],
  )
  next.categories.forEach((category, index) => {
    const incoming = input[index]
    const persisted = incoming.filter((i) => has(i, 'id'))
    const ids = new Set(persisted.map((i) => (i as { id: string }).id))
    // Conjunto de itens persistidos tem de ser exatamente o existente (sem omitir nem inventar).
    if (
      ids.size !== persisted.length ||
      ids.size !== category.items.length ||
      category.items.some((i) => !ids.has(i.id))
    )
      throw new AdminApiError('rejected')
    const byId = new Map(category.items.map((i) => [i.id, i]))
    const items: AdminItem[] = incoming.map((entry) => {
      const base = has(entry, 'id') ? byId.get(entry.id) : undefined
      const clientId = has(entry, 'clientId') ? entry.clientId : undefined
      if (clientId !== undefined && (knownRefs.has(clientId) || !clientId.startsWith('tmp:')))
        throw new AdminApiError('rejected') // clientId já persistido reaparecendo como novo
      const id = base?.id ?? `item_${crypto.randomUUID()}`
      if (clientId !== undefined) {
        knownRefs.add(clientId)
        result.items.push({ clientId, id })
      }
      const existing = new Map((base?.variants ?? []).map((v) => [v.code, v]))
      const persistedCodes = entry.variants.filter((v) => has(v, 'code'))
      if (
        persistedCodes.length !== existing.size ||
        persistedCodes.some((v) => !existing.has((v as { code: string }).code))
      )
        throw new AdminApiError('rejected')
      const variants: AdminVariant[] = entry.variants.map((variant) => {
        if (has(variant, 'code')) {
          const old = existing.get(variant.code) as AdminVariant
          // code, label e volume de variantes persistidas são imutáveis; só o preço muda.
          return { ...old, priceCents: variant.priceCents }
        }
        if (knownRefs.has(variant.clientId)) throw new AdminApiError('rejected')
        knownRefs.add(variant.clientId)
        const code = `v_${crypto.randomUUID()}`
        result.variants.push({ itemId: id, clientId: variant.clientId, code })
        return {
          code,
          creationRef: variant.clientId,
          label: variant.label,
          volumeMl: variant.volumeMl,
          priceCents: variant.priceCents,
        }
      })
      if (variants.length === 0) throw new AdminApiError('rejected')
      return {
        id,
        ...((clientId ?? base?.creationRef) ? { creationRef: clientId ?? base?.creationRef } : {}),
        name: entry.name,
        description: entry.description,
        visible: entry.visible,
        variants,
      }
    })
    category.items = items
  })
  return next
}

export function createMockGateway(mode: MockMode = undefined, latency = 700): AdminCatalogGateway {
  let stored: AdminCatalog =
    mode === 'empty'
      ? {
          revision: '1',
          categories: createMockCatalog().categories.map((c) => ({ ...c, items: [] })),
        }
      : createMockCatalog()
  let loads = 0
  let otherSessionSaved = false
  let responseLost = false
  return {
    async load(signal) {
      await wait(mode === 'slow' ? 3500 : latency, signal)
      // O primeiro carregamento falha; "Tentar de novo" recupera.
      if (mode === 'error' && loads++ === 0) throw new AdminApiError('unavailable')
      return structuredClone(stored)
    },
    async save(input) {
      await wait(latency + 300)
      if (mode === 'save-error') throw new AdminApiError('unavailable')
      if (mode === 'expired') throw new AdminApiError('unauthenticated')
      if (mode === 'conflict' && !otherSessionSaved) {
        // Simula outra sessão salvando antes: o Dronken 30 L muda e a revisão avança.
        otherSessionSaved = true
        stored = structuredClone(stored)
        stored.categories[0].items[0].variants[0].priceCents = 53000
        stored.revision = String(Number(stored.revision) + 1)
      }
      // Mesma regra exigida do servidor real: base desatualizada não grava nada.
      if (input.revision !== stored.revision) throw new AdminApiError('conflict')
      if (input.categories.length !== stored.categories.length) throw new AdminApiError('rejected')
      const created: SaveResult['created'] = { items: [], variants: [] }
      const next = apply(
        stored,
        stored.categories.map((category) => {
          const match = input.categories.find((c) => c.id === category.id)
          if (!match) throw new AdminApiError('rejected')
          return match.items
        }),
        created,
      )
      const changed = JSON.stringify(next.categories) !== JSON.stringify(stored.categories)
      stored = changed ? { ...next, revision: String(Number(stored.revision) + 1) } : stored
      if (mode === 'lost-response' && !responseLost) {
        // Gravou, mas a resposta se perde: o cliente vê falha e não sabe se foi persistido.
        responseLost = true
        throw new AdminApiError('unavailable')
      }
      return { catalog: structuredClone(stored), created }
    },
  }
}
