import type { ReactNode } from 'react'
import heroKeg from '@/shared/assets/kegs/keg-hero-50l.webp'
import studioKeg from '@/shared/assets/kegs/keg-studio-30l.webp'
import styles from './ProtoPastel.module.css'

/**
 * Barris com fundo transparente para o experimento Pastel (somente DEV).
 *
 * Usa os mesmos WebP da vitrine pública (`src/shared/assets/kegs/`): não há cópia própria do
 * protótipo. Os tipos permanecem `string | null` para o fallback para a foto original continuar
 * valendo se um dia o arquivo faltar.
 */
export const cutouts: { hero50: string | null; studio30: string | null } = {
  hero50: heroKeg,
  studio30: studioKeg,
}

/** Mesma regra de escolha de foto do carrossel oficial (BarrelCarousel3D), sem alterá-lo. */
export function cutoutForItem(itemId: string, index: number): string | null {
  const studio = itemId === 'palato-beber' || itemId === 'villa-alema' || index % 2 === 0
  return studio ? cutouts.studio30 : cutouts.hero50
}

export type Surface = 'cream' | 'sage' | 'blue'

export const surfaces: ReadonlyArray<{ id: Surface; label: string }> = [
  { id: 'cream', label: 'Creme' },
  { id: 'sage', label: 'Sálvia' },
  { id: 'blue', label: 'Azul-pó' },
]

export function surfaceFromLocation(): Surface {
  const value = new URLSearchParams(window.location.search).get('surface')
  return surfaces.some((s) => s.id === value) ? (value as Surface) : 'sage'
}

/** `current` é a composição aprovada até aqui; `refined` testa Hero sálvia, vitrine creme e card azul-pó. */
export type Composition = 'current' | 'refined'

export const compositions: ReadonlyArray<{ id: Composition; label: string }> = [
  { id: 'current', label: 'Atual' },
  { id: 'refined', label: 'Nova (vitrine creme)' },
]

export function compositionFromLocation(): Composition {
  const value = new URLSearchParams(window.location.search).get('composition')
  return value === 'refined' ? 'refined' : 'current'
}

/**
 * Barril recortado: dimensões naturais (nunca amplia além do arquivo), proporção preservada e
 * uma sombra de contato desenhada em CSS. Nenhuma máscara nem blend mode simula a transparência.
 */
export function Cutout({ src, alt, eager = true }: { src: string; alt: string; eager?: boolean }) {
  return (
    <span className={styles.cutout}>
      <img src={src} alt={alt} className={styles.cutoutImg} loading={eager ? 'eager' : 'lazy'} />
    </span>
  )
}

/** Fallback explícito: sem recorte disponível a mídia padrão do componente é usada. */
export function cutoutMedia(itemId: string, index: number, alt: string): ReactNode | null {
  const src = cutoutForItem(itemId, index)
  return src ? <Cutout src={src} alt={alt} /> : null
}
