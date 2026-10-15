import { formatBRL } from '@/shared/lib/format'
import { type CatalogVariantV2, centsToReaisSafe } from './types'
import { formatPresentation, type VolumeUnit } from './volume'

export type { VolumeUnit }
/** Rótulo + volume sem repetição. A regra vive em volume.ts e é a mesma da cachaça. */
export function formatVariantLabel(
  variant: Pick<CatalogVariantV2, 'label' | 'volumeMl'>,
  unit: VolumeUnit,
): string {
  return formatPresentation(variant, unit)
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
