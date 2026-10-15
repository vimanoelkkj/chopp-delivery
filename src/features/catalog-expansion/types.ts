import { formatBRL } from '@/shared/lib/format'

/**
 * Contrato público v2 para catálogo expansível.
 * Representa categorias, itens e variantes comerciais com suporte a
 * múltiplos volumes, preços em centavos inteiros e expansão arbitrária.
 */

export type CatalogVariantV2 = {
  /** Código único da variante dentro do item (ex.: '7.5', '20', '30', '50', 'bottle-700'). */
  code: string
  /** Rótulo descritivo para exibição (ex.: 'Barril 7,5 L', 'Garrafa 700 ml'). */
  label: string
  /** Volume em mililitros quando aplicável (ex.: 7500, 20000, 30000, 50000, 700). */
  volumeMl?: number | null
  /**
   * Preço em centavos inteiros (ex.: 51000 = R$ 510,00).
   * `null` indica tamanho/variante não comercializada para este produto.
   */
  priceCents: number | null
  /** Ordem de exibição da variante */
  sortOrder?: number
}

export type CatalogItemV2 = {
  id: string
  name: string
  description: string
  /** Controla se o item aparece no catálogo público. */
  visible: boolean
  sortOrder?: number
  /** Lista de variantes comerciais (barris, garrafas, etc.). */
  variants: CatalogVariantV2[]
}

export type CatalogCategoryV2 = {
  id: string
  name: string
  sortOrder?: number
  items: CatalogItemV2[]
}

export type PublicCatalogV2 = {
  revision: string
  categories: CatalogCategoryV2[]
}

export type FilterCatalogOptions = {
  includeHidden?: boolean
  omitEmptyCategories?: boolean
}

/**
 * Filtra e retorna as categorias públicas contendo produtos visíveis,
 * expurgando itens com `visible: false` e categorias vazias por padrão.
 */
export function getVisibleCatalog(
  catalog: PublicCatalogV2,
  options?: FilterCatalogOptions,
): CatalogCategoryV2[] {
  const includeHidden = options?.includeHidden ?? false
  const omitEmptyCategories = options?.omitEmptyCategories ?? true

  return catalog.categories
    .map((category) => ({
      ...category,
      items: includeHidden ? category.items : category.items.filter((item) => item.visible),
    }))
    .filter((category) => (omitEmptyCategories ? category.items.length > 0 : true))
}

/**
 * Converte valor em centavos inteiros para reais sem perda de precisão.
 * Retorna null se priceCents for null ou undefined.
 */
export function centsToReaisSafe(priceCents: number | null | undefined): number | null {
  if (priceCents === null || priceCents === undefined) return null
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
    throw new Error('Centavos inválidos')
  }
  return priceCents / 100
}

/**
 * Formata centavos para apresentação BRL (ex.: 38000 -> "R$ 380", 27550 -> "R$ 275,50", null -> "—").
 */
export function formatPriceFromCents(priceCents: number | null | undefined): string {
  if (priceCents === null || priceCents === undefined) return '—'
  const reais = centsToReaisSafe(priceCents)
  if (reais === null) return '—'
  return formatBRL(reais, { cents: priceCents % 100 !== 0 })
}
