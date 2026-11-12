import brahmaKeg from '../assets/kegs/brahma.webp'
import wineKeg from '../assets/kegs/chopp-de-vinho.webp'
import dronkenKeg from '../assets/kegs/dronken.webp'
import heinekenKeg from '../assets/kegs/heineken.webp'
import kaiserKeg from '../assets/kegs/kaiser.webp'
import heroKeg from '../assets/kegs/keg-hero-50l.webp'
import studioKeg from '../assets/kegs/keg-studio-30l.webp'
import krugKeg from '../assets/kegs/krug-bier.webp'
import palatoKeg from '../assets/kegs/palato-beber.webp'
import villaKeg from '../assets/kegs/villa-alema.webp'
import styles from './KegCutout.module.css'

/** Recortes WebP transparentes. */
const PHOTOS = {
  hero50: { src: heroKeg, width: 452, height: 690 },
  studio30: { src: studioKeg, width: 605, height: 864 },
  brahma: { src: brahmaKeg, width: 900, height: 900 },
  'chopp-de-vinho': { src: wineKeg, width: 900, height: 900 },
  dronken: { src: dronkenKeg, width: 900, height: 900 },
  heineken: { src: heinekenKeg, width: 900, height: 900 },
  kaiser: { src: kaiserKeg, width: 900, height: 900 },
  'krug-bier': { src: krugKeg, width: 900, height: 900 },
  'palato-beber': { src: palatoKeg, width: 900, height: 900 },
  'villa-alema': { src: villaKeg, width: 900, height: 900 },
} as const

export type KegPhoto = keyof typeof PHOTOS

const PHOTO_BY_ITEM: Record<string, KegPhoto> = {
  brahma: 'brahma',
  'chopp-de-vinho': 'chopp-de-vinho',
  dronken: 'dronken',
  heineken: 'heineken',
  kaiser: 'kaiser',
  'krug-bier': 'krug-bier',
  'palato-beber': 'palato-beber',
  'villa-alema': 'villa-alema',
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
