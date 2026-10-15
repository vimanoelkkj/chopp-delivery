import type { PublicCatalog } from '../../../shared/catalog'
import { centsToReais } from '../../../shared/money'
import type { Product } from './types'

function object(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Contrato inválido')
  return v as Record<string, unknown>
}
function text(v: unknown, empty = false): string {
  if (typeof v !== 'string' || (!empty && !v.trim())) throw new Error('Texto inválido')
  return v
}
export type StorefrontCatalog = { products: Product[]; expanded: PublicCatalog }
/** Parses every category and variant. A bad entry fails the entire response. */
export function parseExpandedCatalog(value: unknown): StorefrontCatalog {
  const data = object(value)
  const revision = text(data.revision)
  if (!Array.isArray(data.categories)) throw new Error('Categorias inválidas')
  const ids = new Set<string>(),
    categoryIds = new Set<string>()
  const expanded: PublicCatalog = {
    revision,
    categories: data.categories.map((value) => {
      const c = object(value),
        id = text(c.id)
      if (categoryIds.has(id) || !Array.isArray(c.items)) throw new Error('Categoria inválida')
      categoryIds.add(id)
      return {
        id,
        name: text(c.name),
        items: c.items.map((value) => {
          const i = object(value),
            id = text(i.id)
          if (ids.has(id) || i.visible !== true || !Array.isArray(i.variants) || !i.variants.length)
            throw new Error('Item inválido')
          ids.add(id)
          const codes = new Set<string>()
          const variants = i.variants.map((value) => {
            const v = object(value),
              code = text(v.code)
            if (codes.has(code)) throw new Error('Variante duplicada')
            codes.add(code)
            const { volumeMl, priceCents } = v
            if (
              !(
                (volumeMl === null && !['chopes', 'cachacas'].includes(c.id as string)) ||
                (typeof volumeMl === 'number' && Number.isSafeInteger(volumeMl) && volumeMl > 0)
              )
            )
              throw new Error('Volume inválido')
            if (
              !(
                (priceCents === null && c.id !== 'cachacas') ||
                (typeof priceCents === 'number' &&
                  Number.isSafeInteger(priceCents) &&
                  priceCents >= 1 &&
                  priceCents <= 9999999)
              )
            )
              throw new Error('Preço inválido')
            if (priceCents !== null) centsToReais(priceCents as number)
            return {
              code,
              label: text(v.label),
              volumeMl: volumeMl as number | null,
              priceCents: priceCents as number | null,
            }
          })
          if (!variants.some((v) => v.priceCents !== null)) throw new Error('Item sem preço')
          return {
            id,
            name: text(i.name),
            description: text(i.description, true),
            visible: true,
            variants,
          }
        }),
      }
    }),
  }
  const chopes = expanded.categories.find((c) => c.id === 'chopes')?.items ?? []
  const products = chopes.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    visible: true,
    prices: { 30: priceForVolume(i, 30000), 50: priceForVolume(i, 50000) },
  }))
  return { expanded, products }
}
function priceForVolume(
  item: PublicCatalog['categories'][number]['items'][number],
  volume: number,
) {
  const prices = item.variants
    .filter((v) => v.volumeMl === volume && v.priceCents !== null)
    .map((v) => v.priceCents as number)
  return prices.length ? centsToReais(Math.min(...prices)) : null
}
export async function fetchExpandedCatalog(signal: AbortSignal): Promise<StorefrontCatalog> {
  const response = await fetch('/api/catalog', { method: 'GET', cache: 'no-store', signal })
  if (!response.ok) throw new Error('Catálogo indisponível')
  return parseExpandedCatalog(await response.json())
}
export const standardChopes = (items: PublicCatalog['categories'][number]['items']) =>
  items.every(
    (i) =>
      i.variants.length === 2 &&
      i.variants.map((v) => v.code).join(',') === '30,50' &&
      ['30', '50'].every((code) =>
        i.variants.some(
          (v) =>
            v.code === code &&
            v.volumeMl === Number(code) * 1000 &&
            v.label === `Barril de ${code} L`,
        ),
      ),
  )
