import { type CategoryId, VOLUME_MAX_ML } from './types'

export type VolumeUnit = 'L' | 'ml'

/** Unidade em que o administrador digita o volume. O contrato e o estado canônico são sempre ml. */
const UNIT: Record<CategoryId, VolumeUnit> = { chopes: 'L' }
export const volumeUnit = (category: CategoryId): VolumeUnit => UNIT[category] ?? 'ml'

export type VolumeParse = { ok: true; ml: number } | { ok: false; message: string }

export const volumeMessage = (unit: VolumeUnit) =>
  unit === 'L'
    ? 'Informe o volume em litros (ex.: 20 ou 7,5).'
    : 'Informe o volume em ml (inteiro positivo).'

/**
 * Texto digitado → ml inteiros, só com aritmética inteira (20 L = 20000 ml, 7,5 L = 7500 ml).
 * Litros aceitam até 3 casas (1 ml de resolução), com vírgula ou ponto.
 */
export function parseVolume(raw: string, unit: VolumeUnit): VolumeParse {
  const text = raw.trim()
  const invalid = { ok: false, message: volumeMessage(unit) } as const
  let ml: number
  if (unit === 'ml') {
    if (!/^\d{1,9}$/.test(text)) return invalid
    ml = Number(text)
  } else {
    const match = /^(\d{1,6})(?:[.,](\d{1,3}))?$/.exec(text)
    if (!match) return invalid
    ml = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'))
  }
  if (ml < 1) return invalid
  if (ml > VOLUME_MAX_ML) return { ok: false, message: 'Volume acima do limite.' }
  return { ok: true, ml }
}

/** Filtra a digitação: ml só dígitos; litros dígitos com um separador e até 3 casas. */
export function sanitizeVolumeInput(raw: string, unit: VolumeUnit): string {
  if (unit === 'ml') return raw.replace(/\D/g, '')
  const [whole, ...rest] = raw.replace(/[^\d.,]/g, '').split(/[.,]/)
  return rest.length ? `${whole},${rest.join('').slice(0, 3)}` : whole
}

/** ml → texto na unidade de exibição, exato (30000 → "30 L", 7500 → "7,5 L", 700 → "700 ml"). */
export function formatVolume(ml: number, unit: VolumeUnit): string {
  if (unit === 'ml') return `${ml} ml`
  const rest = String(ml % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${Math.trunc(ml / 1000)}${rest ? `,${rest}` : ''} L`
}
