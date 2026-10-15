import type { AdminCatalog, AdminItem, AdminVariant, SaveResult } from './types'

/**
 * Validação em tempo de execução das respostas do backend. CONTRATO PROVISÓRIO: o formato segue
 * `tasks/plan.md` da branch `feat/catalog-expansion` (F3A.2, ainda em implementação). Qualquer
 * resposta fora disto lança `WireError` e vira `unavailable` no gateway: nunca se mostra um
 * catálogo parcial ou adivinhado.
 */
export class WireError extends Error {}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new WireError(`${what}: objeto esperado`)
  return value as Record<string, unknown>
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new WireError(`${what}: texto esperado`)
  return value
}

function optionalRef(value: unknown, what: string): string | null {
  if (value === undefined || value === null) return null
  return text(value, what)
}

function cents(value: unknown, what: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new WireError(`${what}: centavos inteiros positivos ou null`)
  return value
}

function volume(value: unknown, what: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new WireError(`${what}: ml inteiros positivos ou null`)
  return value
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new WireError(`${what}: lista esperada`)
  return value
}

function variant(value: unknown): AdminVariant {
  const v = record(value, 'variante')
  return {
    code: text(v.code, 'variante.code'),
    creationRef: optionalRef(v.creationRef, 'variante.creationRef'),
    label: text(v.label, 'variante.label'),
    volumeMl: volume(v.volumeMl, 'variante.volumeMl'),
    priceCents: cents(v.priceCents, 'variante.priceCents'),
  }
}

function item(value: unknown): AdminItem {
  const i = record(value, 'item')
  if (typeof i.visible !== 'boolean') throw new WireError('item.visible: boolean esperado')
  const variants = list(i.variants, 'item.variants').map(variant)
  if (variants.length === 0) throw new WireError('item sem variantes')
  return {
    id: text(i.id, 'item.id'),
    creationRef: optionalRef(i.creationRef, 'item.creationRef'),
    name: text(i.name, 'item.name'),
    description: text(i.description, 'item.description'),
    visible: i.visible,
    variants,
  }
}

/** Snapshot completo: revision + categorias → itens → variantes, na ordem de exibição. */
export function parseSnapshot(value: unknown): AdminCatalog {
  const data = record(value, 'catálogo')
  const categories = list(data.categories, 'categories').map((entry) => {
    const category = record(entry, 'categoria')
    return {
      id: text(category.id, 'categoria.id'),
      name: text(category.name, 'categoria.name'),
      items: list(category.items, 'categoria.items').map(item),
    }
  })
  const ids = categories.flatMap((c) => c.items.map((i) => i.id))
  if (new Set(ids).size !== ids.length) throw new WireError('ids de item repetidos')
  return { revision: text(data.revision, 'revision'), categories }
}

/** Resposta do PUT: `{ catalog, created: { items, variants } }`. */
export function parseSaveResult(value: unknown): SaveResult {
  const data = record(value, 'resposta do PUT')
  const created = record(data.created, 'created')
  return {
    catalog: parseSnapshot(data.catalog),
    created: {
      items: list(created.items, 'created.items').map((entry) => {
        const e = record(entry, 'created.item')
        return { clientId: text(e.clientId, 'clientId'), id: text(e.id, 'id') }
      }),
      variants: list(created.variants, 'created.variants').map((entry) => {
        const e = record(entry, 'created.variant')
        return {
          itemId: text(e.itemId, 'itemId'),
          clientId: text(e.clientId, 'clientId'),
          code: text(e.code, 'code'),
        }
      }),
    },
  }
}
