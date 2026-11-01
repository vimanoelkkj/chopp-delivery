import { useCallback, useEffect, useRef, useState } from 'react'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { formatBRL, formatCatalogVolume } from '@/shared/lib/format'
import type { PublicCatalog } from '../../../shared/catalog'
import { centsToReais } from '../../../shared/money'
import styles from './BarrelCarousel3D.module.css'

export type CarouselItem = PublicCatalog['categories'][number]['items'][number]

export interface CarouselVariant {
  code: string
  label: string
  volumeMl: number | null
  price: number | null
  displayLabel: string
}

export interface CarouselKeg {
  id: string
  name: string
  subtitle: string
  badgeText?: string
  badgeVariant?: 'amber' | 'outline'
  variants: CarouselVariant[]
  price30: number | null
  price50: number | null
  image: string
  alt: string
}

export interface BarrelCarousel3DProps {
  items: CarouselItem[]
  onSelectKeg?: (keg: CarouselKeg) => void
  initialSelectedId?: string
}

/** Cria handler de navegação por teclado com guarda de foco no carrossel (A08) */
export function createKeyboardNavHandler(
  count: number,
  wrapperRef: { current: HTMLElement | null },
  next: () => void,
  prev: () => void,
) {
  return (e: KeyboardEvent | { key: string; preventDefault?: () => void }) => {
    if (count <= 1) return
    if (!wrapperRef.current?.contains(document.activeElement)) return
    if (e.key === 'ArrowRight') {
      e.preventDefault?.()
      next()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault?.()
      prev()
    }
  }
}

/** Valida se o gesto touch possui intenção predominantemente horizontal (A09) */
export function isHorizontalSwipeIntent(diffX: number, diffY: number): boolean {
  return Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.5
}

export function BarrelCarousel3D({ items, onSelectKeg, initialSelectedId }: BarrelCarousel3DProps) {
  // Constrói os barris a partir dos itens reais do catálogo (sem dados fictícios)
  const kegs: CarouselKeg[] = items.map((item, idx) => {
    const rawVariants = item.variants.map((v) => ({
      code: v.code,
      label: v.label,
      volumeMl: v.volumeMl,
      price: v.priceCents !== null ? centsToReais(v.priceCents) : null,
    }))

    const variants: CarouselVariant[] = rawVariants.map((v) => {
      const volStr = formatCatalogVolume(v.volumeMl)
      const sameVolCount = v.volumeMl
        ? rawVariants.filter((x) => x.volumeMl === v.volumeMl).length
        : 0

      const isGeneric30 =
        /^barril\s*(de\s*)?30\s*l?$/i.test(v.label.trim()) || v.label.trim() === '30'
      const isGeneric50 =
        /^barril\s*(de\s*)?50\s*l?$/i.test(v.label.trim()) || v.label.trim() === '50'

      let displayLabel: string
      if (isGeneric30) {
        displayLabel = '30L'
      } else if (isGeneric50) {
        displayLabel = '50L'
      } else if (sameVolCount > 1) {
        displayLabel = volStr ? `${v.label} ${volStr}` : v.label
      } else if (volStr && !v.label.toLowerCase().includes(volStr.toLowerCase())) {
        displayLabel = `${v.label} (${volStr})`
      } else {
        displayLabel = v.label
      }

      return {
        ...v,
        displayLabel,
      }
    })

    const v30 = variants.find((v) => v.code === '30' || v.volumeMl === 30000)
    const v50 = variants.find((v) => v.code === '50' || v.volumeMl === 50000)
    const price30 = v30?.price ?? null
    const price50 = v50?.price ?? null

    const availableVolMls = Array.from(
      new Set(
        variants
          .map((v) => (v.price !== null && v.volumeMl !== null ? v.volumeMl : null))
          .filter((v): v is number => v !== null),
      ),
    )
    let badgeText: string | undefined
    let badgeVariant: 'amber' | 'outline' = 'outline'
    if (availableVolMls.length === 1) {
      badgeText = `Apenas ${formatCatalogVolume(availableVolMls[0])}`
      badgeVariant = 'amber'
    }

    const image =
      item.id === 'palato-beber' || item.id === 'villa-alema' || idx % 2 === 0
        ? '/images/kegs/keg-studio-30l.jpg'
        : '/images/kegs/keg-hero-50l.jpg'

    return {
      id: item.id,
      name: item.name,
      subtitle: item.description,
      badgeText,
      badgeVariant,
      variants,
      price30,
      price50,
      image,
      alt: `Barril de Chopp ${item.name} em Aço Inox`,
    }
  })

  const count = kegs.length

  // Sincronização segura por ID estável
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null)
  const [selectedVariantCode, setSelectedVariantCode] = useState<string | null>(null)
  const [preferredVolumeMl, setPreferredVolumeMl] = useState<number | null>(null)

  const activeIndex = selectedId ? kegs.findIndex((k) => k.id === selectedId) : -1
  const safeIndex = activeIndex >= 0 && activeIndex < count ? activeIndex : 0
  const currentKeg = kegs[safeIndex]

  const trackRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const next = useCallback(() => {
    if (count <= 1) return
    const nextIdx = (safeIndex + 1) % count
    const nextKeg = kegs[nextIdx]
    setSelectedId(nextKeg.id)
    setSelectedVariantCode(null)
    onSelectKeg?.(nextKeg)
  }, [count, safeIndex, kegs, onSelectKeg])

  const prev = useCallback(() => {
    if (count <= 1) return
    const prevIdx = (safeIndex - 1 + count) % count
    const prevKeg = kegs[prevIdx]
    setSelectedId(prevKeg.id)
    setSelectedVariantCode(null)
    onSelectKeg?.(prevKeg)
  }, [count, safeIndex, kegs, onSelectKeg])

  // A08: Listener de teclado ativo apenas quando o carrossel possuir o foco
  const handleKeyDown = useCallback(
    (e: KeyboardEvent | { key: string; preventDefault?: () => void }) => {
      createKeyboardNavHandler(count, wrapperRef, next, prev)(e)
    },
    [count, next, prev],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Gestos touch com verificação de intenção horizontal e tratamento de cancelamento (A09)
  const handleTouchStart = (
    e: React.TouchEvent | { touches: Array<{ clientX: number; clientY: number }> },
  ) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchCancel = () => {
    touchStartX.current = null
    touchStartY.current = null
  }

  const handleTouchEnd = (
    e: React.TouchEvent | { changedTouches: Array<{ clientX: number; clientY: number }> },
  ) => {
    if (touchStartX.current === null || touchStartY.current === null) return
    const touchEndX = e.changedTouches[0].clientX
    const touchEndY = e.changedTouches[0].clientY
    const diffX = touchEndX - touchStartX.current
    const diffY = touchEndY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null

    if (isHorizontalSwipeIntent(diffX, diffY)) {
      if (diffX < 0) next()
      else prev()
    }
  }

  if (count === 0 || !currentKeg) {
    return null
  }

  // Identificação inequívoca da variante ativa no produto atual (N01 / N02 / N03)
  const availableVariants = currentKeg.variants.filter((v) => v.price !== null)
  let activeVariant: CarouselVariant | undefined

  if (selectedVariantCode) {
    activeVariant = availableVariants.find((v) => v.code === selectedVariantCode)
  }

  if (!activeVariant && preferredVolumeMl !== null) {
    activeVariant = availableVariants.find(
      (v) =>
        v.volumeMl === preferredVolumeMl ||
        v.code === String(preferredVolumeMl) ||
        (preferredVolumeMl >= 1000 && v.code === String(preferredVolumeMl / 1000)),
    )
  }

  if (!activeVariant) {
    activeVariant =
      availableVariants.find((v) => v.volumeMl === 30000 || v.code === '30') ??
      availableVariants.find((v) => v.volumeMl === 50000 || v.code === '50') ??
      availableVariants[0] ??
      currentKeg.variants[0]
  }

  let activePresentationText = ''
  if (activeVariant) {
    const volStr = formatCatalogVolume(activeVariant.volumeMl)
    const isGeneric30 =
      /^barril\s*(de\s*)?30\s*l?$/i.test(activeVariant.label.trim()) ||
      activeVariant.label.trim() === '30'
    const isGeneric50 =
      /^barril\s*(de\s*)?50\s*l?$/i.test(activeVariant.label.trim()) ||
      activeVariant.label.trim() === '50'

    if (isGeneric30) {
      activePresentationText = '30L'
    } else if (isGeneric50) {
      activePresentationText = '50L'
    } else if (volStr && !activeVariant.label.toLowerCase().includes(volStr.toLowerCase())) {
      activePresentationText = `${activeVariant.label} - ${volStr}`
    } else {
      activePresentationText = activeVariant.label
    }
  } else {
    activePresentationText = 'barril'
  }

  const orderMessage = `Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de ${currentKeg.name} (${activePresentationText}).`

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <section
        className={styles.scene}
        aria-roledescription="carrossel 3d"
        aria-label="Vitrine de Barris 3D em Aço Inox. Use as setas do teclado para navegar."
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <div ref={trackRef} id="carousel-track" className={styles.track}>
          {kegs.map((keg, index) => {
            let slotClass = styles.posHidden
            const diff = (index - safeIndex + count) % count

            if (count === 1) {
              slotClass = styles.posCenter
            } else if (count === 2) {
              slotClass = diff === 0 ? styles.posCenter : styles.posRight
            } else {
              if (diff === 0) {
                slotClass = styles.posCenter
              } else if (diff === 1 || diff === -(count - 1)) {
                slotClass = styles.posRight
              } else if (diff === count - 1 || diff === -1) {
                slotClass = styles.posLeft
              }
            }

            const isCenter = diff === 0

            return (
              <article
                key={keg.id}
                className={`${styles.card} ${slotClass}`}
                onClick={() => {
                  if (!isCenter) {
                    setSelectedId(keg.id)
                    setSelectedVariantCode(null)
                    onSelectKeg?.(keg)
                  }
                }}
                aria-hidden={!isCenter}
              >
                <div className={styles.imageWrap}>
                  <img src={keg.image} alt={keg.alt} className={styles.kegImg} loading="eager" />
                  {keg.badgeText && (
                    <span
                      className={`${styles.badge} ${
                        keg.badgeVariant === 'amber' ? styles.badgeAmber : styles.badgeOutline
                      }`}
                    >
                      {keg.badgeText}
                    </span>
                  )}
                </div>

                <div className={styles.content}>
                  <h3 className={styles.name}>{keg.name}</h3>
                  <p className={styles.desc}>{keg.subtitle}</p>

                  <div className={styles.prices}>
                    {keg.variants.map((v, vIdx) => {
                      const isSelected = isCenter && activeVariant?.code === v.code
                      const priceValue = v.price
                      const isAvail = priceValue !== null
                      const priceText = priceValue !== null ? formatBRL(priceValue) : 'Indisp.'

                      return (
                        <span key={v.code} className={styles.variantItem}>
                          {vIdx > 0 && <span className={styles.priceSep}>|</span>}
                          <button
                            type="button"
                            disabled={!isCenter || !isAvail}
                            className={`${styles.volumeBtn} ${
                              isSelected ? styles.priceSelected : ''
                            }`}
                            onClick={(e) => {
                              if (isCenter && isAvail) {
                                e.stopPropagation()
                                setSelectedId(keg.id)
                                setSelectedVariantCode(v.code)
                                if (v.volumeMl !== null) setPreferredVolumeMl(v.volumeMl)
                              }
                            }}
                            aria-label={
                              v.volumeMl === 50000
                                ? `Selecionar volume 50 Litros (${v.displayLabel}) por ${priceText}`
                                : v.volumeMl === 30000
                                  ? `Selecionar volume 30 Litros (${v.displayLabel}) por ${priceText}`
                                  : `Selecionar ${v.displayLabel} por ${priceText}`
                            }
                          >
                            {v.displayLabel}:{' '}
                            {priceValue !== null ? (
                              formatBRL(priceValue)
                            ) : (
                              <span className={styles.priceMuted}>Indisp.</span>
                            )}
                          </button>
                        </span>
                      )
                    })}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {count > 1 && (
        <div className={styles.controls} aria-controls="carousel-track">
          <button
            type="button"
            onClick={prev}
            className={styles.navBtn}
            aria-label="Barril Anterior"
          >
            ← Anterior
          </button>

          <div className={styles.status} aria-live="polite">
            Barril <span className={styles.statusIndex}>{safeIndex + 1}</span> de {count} •{' '}
            <span className={styles.statusName}>{currentKeg.name}</span>
          </div>

          <button
            type="button"
            onClick={next}
            className={styles.navBtn}
            aria-label="Próximo Barril"
          >
            Próximo →
          </button>
        </div>
      )}

      {count === 1 && (
        <div className={styles.controls}>
          <div className={styles.status} aria-live="polite">
            Barril <span className={styles.statusIndex}>1</span> de 1 •{' '}
            <span className={styles.statusName}>{currentKeg.name}</span>
          </div>
        </div>
      )}

      <div className={styles.actionRow}>
        <WhatsAppButton customText={orderMessage} variant="gold">
          Pedir Barril {currentKeg.name} no WhatsApp
        </WhatsAppButton>
      </div>
    </div>
  )
}
