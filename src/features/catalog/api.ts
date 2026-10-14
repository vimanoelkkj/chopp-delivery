import { reaisToCents } from '../../../shared/money'
import type { Catalog, Product } from './types'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Contrato do catálogo inválido')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error('Texto do catálogo inválido')
  }
  return value
}

function price(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Preço do catálogo inválido')
  reaisToCents(value)
  return value
}

function product(value: unknown): Product {
  const item = record(value)
  const prices = record(item.prices)
  if (item.visible !== true) throw new Error('Produto oculto na API pública')
  return {
    id: text(item.id),
    name: text(item.name),
    description: text(item.description, true),
    visible: true,
    prices: {
      30: prices[30] === null ? null : price(prices[30]),
      50: prices[50] === null ? null : price(prices[50]),
    },
  }
}

export function parseCatalog(value: unknown): Catalog {
  const data = record(value)
  if (!Array.isArray(data.products)) throw new Error('Lista de produtos inválida')
  const products = data.products.map(product)
  if (new Set(products.map((item) => item.id)).size !== products.length) {
    throw new Error('IDs de produtos duplicados')
  }
  let cachaca: Catalog['cachaca'] = null
  if (data.cachaca !== null) {
    const item = record(data.cachaca)
    if (
      typeof item.bottleMl !== 'number' ||
      !Number.isSafeInteger(item.bottleMl) ||
      item.bottleMl <= 0
    ) {
      throw new Error('Volume da cachaça inválido')
    }
    cachaca = {
      id: text(item.id),
      title: text(item.title),
      description: text(item.description, true),
      bottleMl: item.bottleMl,
      price: price(item.price),
    }
  }
  return { products, cachaca }
}

export async function fetchCatalog(signal: AbortSignal): Promise<Catalog> {
  const response = await fetch('/api/products', { method: 'GET', cache: 'no-store', signal })
  if (!response.ok) throw new Error('Catálogo indisponível')
  return parseCatalog(await response.json())
}
