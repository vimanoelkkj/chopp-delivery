import heroKeg from '../assets/kegs/keg-hero-50l.webp'
import studioKeg from '../assets/kegs/keg-studio-30l.webp'
import styles from './KegCutout.module.css'

/** As duas fotografias de barril existentes, recortadas com transparência real (WebP). */
const PHOTOS = {
  hero50: { src: heroKeg, width: 452, height: 690 },
  studio30: { src: studioKeg, width: 605, height: 864 },
} as const

export type KegPhoto = keyof typeof PHOTOS

/** Mesma regra de escolha de foto que o carrossel já usava, agora para os recortes. */
export function kegPhotoForItem(itemId: string, index: number): KegPhoto {
  return itemId === 'palato-beber' || itemId === 'villa-alema' || index % 2 === 0
    ? 'studio30'
    : 'hero50'
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
