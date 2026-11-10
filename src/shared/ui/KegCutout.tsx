import heroKeg from '../assets/kegs/keg-hero-50l.webp'
import studioKeg from '../assets/kegs/keg-studio-30l.webp'
import styles from './KegCutout.module.css'

/** As duas fotografias de barril existentes, recortadas com transparência real (WebP). */
const PHOTOS = {
  hero50: { src: heroKeg, width: 452, height: 690 },
  studio30: { src: studioKeg, width: 605, height: 864 },
} as const

export type KegPhoto = keyof typeof PHOTOS

/**
 * Fotografia específica de cada chope do catálogo original, por identidade. É o mesmo resultado que
 * a antiga regra por posição dava na ordem aprovada, mas agora não muda se a ordem ou a seleção
 * mudar. Produto fora desta lista não tem foto própria: usa `KegPlaceholder`.
 */
const PHOTO_BY_ITEM: Record<string, KegPhoto> = {
  dronken: 'studio30',
  'palato-beber': 'studio30',
  'villa-alema': 'studio30',
  'krug-bier': 'hero50',
  brahma: 'studio30',
  kaiser: 'hero50',
  heineken: 'studio30',
  'chopp-de-vinho': 'hero50',
}

export function kegPhotoForItem(itemId: string): KegPhoto | null {
  return Object.hasOwn(PHOTO_BY_ITEM, itemId) ? PHOTO_BY_ITEM[itemId] : null
}

/** Silhueta neutra de barril para produto sem foto própria: sem marca, rótulo nem tamanho. */
export function KegPlaceholder({ alt }: { alt: string }) {
  return (
    <span className={styles.cutout}>
      <svg
        className={styles.placeholder}
        viewBox="0 0 120 180"
        role="img"
        aria-label={alt}
        data-keg-placeholder
      >
        <rect x="14" y="10" width="92" height="160" rx="16" fill="currentColor" opacity="0.14" />
        <rect
          x="14"
          y="10"
          width="92"
          height="160"
          rx="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path d="M14 46h92M14 134h92" stroke="currentColor" strokeWidth="4" />
        <circle cx="60" cy="90" r="16" fill="none" stroke="currentColor" strokeWidth="4" />
      </svg>
    </span>
  )
}

/**
 * Barril recortado: dimensões naturais (nunca ampliado além do arquivo), proporção preservada e
 * sombra de contato desenhada em CSS. O pai precisa ter `position: relative` e altura definida.
 */
export function KegCutout({
  photo,
  alt,
  eager = true,
}: {
  photo: KegPhoto
  alt: string
  eager?: boolean
}) {
  const { src, width, height } = PHOTOS[photo]
  return (
    <span className={styles.cutout}>
      <img
        src={src}
        width={width}
        height={height}
        alt={alt}
        className={styles.image}
        loading={eager ? 'eager' : 'lazy'}
      />
    </span>
  )
}
