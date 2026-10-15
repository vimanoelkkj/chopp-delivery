import { formatBRL } from '@/shared/lib/format'
import { type CatalogVariantV2, centsToReaisSafe } from './types'

export type VolumeUnit = 'L' | 'ml'
export function formatVariantLabel(
  variant: Pick<CatalogVariantV2, 'label' | 'volumeMl'>,
  unit: VolumeUnit,
): string {
  if (variant.volumeMl == null) return variant.label
  const volume = unit === 'L' ? variant.volumeMl / 1000 : variant.volumeMl
  const text = `${volume.toLocaleString('pt-BR')} ${unit}`
  return ` ${variant.label.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')} `.includes(
    ` ${text.toLocaleLowerCase('pt-BR')} `,
  )
    ? variant.label
    : `${variant.label} · ${text}`
}
export function buildCatalogWhatsAppMessage(
  name: string,
  variant: CatalogVariantV2,
  unit: VolumeUnit,
): string | null {
  if (variant.priceCents === null) return null
  const price = centsToReaisSafe(variant.priceCents)
  if (price === null) return null
  return `Olá! Gostaria de pedir ${name}, ${formatVariantLabel(variant, unit)}, por ${formatBRL(price)}.`
}
