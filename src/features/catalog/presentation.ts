import { formatCatalogVolume } from '@/shared/lib/format'
import type { PublicCatalog } from '../../../shared/catalog'
import { centsToReais } from '../../../shared/money'
import type { Product } from './types'

export type PublicItem = PublicCatalog['categories'][number]['items'][number]
export type PublicVariant = PublicItem['variants'][number]

/** Colunas da tabela de comparação: o código e o volume que as identificam. */
const TABLE_VARIANTS = [
  { code: '30', volumeMl: 30000 },
  { code: '50', volumeMl: 50000 },
] as const

const isTableVariant = (variant: PublicVariant) =>
  TABLE_VARIANTS.some((v) => v.code === variant.code && v.volumeMl === variant.volumeMl)

/**
 * Divide os chopes visíveis em duas apresentações sem perder nem repetir variante:
 * - `table`: produtos com preço nas colunas 30 L e 50 L (a tabela aprovada);
 * - `extras`: toda variante que não está na tabela, com o produto de origem.
 * Uma variante 30/50 L sem preço só fica na tabela se o produto vende o outro tamanho.
 */
export function splitChopes(items: PublicItem[]): { table: Product[]; extras: PublicItem[] } {
  const table: Product[] = []
  const extras: PublicItem[] = []
  for (const item of items) {
    if (!item.visible) continue
    const columns = item.variants.filter(isTableVariant)
    const inTable = columns.some((v) => v.priceCents !== null)
    if (inTable) {
      const price = (code: string) => {
        const cents = columns.find((v) => v.code === code)?.priceCents
        return typeof cents === 'number' ? centsToReais(cents) : null
      }
      table.push({
        id: item.id,
        name: item.name,
        description: item.description,
        visible: true,
        prices: { 30: price('30'), 50: price('50') },
      })
    }
    const rest = item.variants.filter((v) => !(inTable && isTableVariant(v)))
    if (rest.length) extras.push({ ...item, variants: rest })
  }
  return { table, extras }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** O rótulo já cita o volume ("Barril de 20 L", "Garrafa 750 ml")? Então não o repetimos. */
export function labelMentionsVolume(label: string, volumeMl: number | null): boolean {
  if (volumeMl === null) return false
  const volume = formatCatalogVolume(volumeMl, { compact: false })
  if (!volume) return false
  const [amount, unit] = volume.split(' ')
  const unitPattern = unit === 'L' ? '(?:l|lt|lts|litros?)' : escapeRegExp(unit)
  const pattern = new RegExp(
    `(?<![\\d.,])${escapeRegExp(amount)}\\s*${unitPattern}(?![\\p{L}\\d])`,
    'iu',
  )
  return pattern.test(label)
}

const genericBarrel = (label: string, liters: number) =>
  new RegExp(`^barril\\s*(de\\s*)?${liters}\\s*l?$`, 'i').test(label.trim()) ||
  label.trim() === String(liters)

/** Texto da apresentação usado no pedido: "30L", "50L" ou rótulo (com volume só se faltar). */
export function presentationText(label: string, volumeMl: number | null): string {
  if (genericBarrel(label, 30)) return '30L'
  if (genericBarrel(label, 50)) return '50L'
  const volume = formatCatalogVolume(volumeMl)
  if (volume && !labelMentionsVolume(label, volumeMl)) return `${label} - ${volume}`
  return label
}

const WORDS = [
  'Zero',
  'Uma',
  'Duas',
  'Três',
  'Quatro',
  'Cinco',
  'Seis',
  'Sete',
  'Oito',
  'Nove',
  'Dez',
  'Onze',
  'Doze',
]

/** Chamada comercial da seção de chopes; a contagem vem do catálogo, nunca de um número fixo. */
export function chopesNote(count: number | null): string {
  if (count === null) return 'Consulte os valores dos barris de 30 e de 50 litros.'
  if (count === 0) return 'Consulte os valores e as apresentações disponíveis na câmara fria.'
  const amount = count < WORDS.length ? WORDS[count] : String(count)
  const noun = count === 1 ? 'opção' : 'opções'
  return `${amount} ${noun} de chopp com valores verificados da câmara fria de São João del-Rei. Chopeira profissional inclusa.`
}
