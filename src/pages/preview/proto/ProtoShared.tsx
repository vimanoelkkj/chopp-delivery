import { type RefObject, useRef } from 'react'
import { lowestPrice } from '@/features/catalog/pricing'
import { type CatalogState, useCatalog } from '@/features/catalog/useCatalog'
import { AboutSection } from '@/pages/landing/sections/AboutSection'
import { CatalogSection } from '@/pages/landing/sections/CatalogSection'
import { ContactSection } from '@/pages/landing/sections/ContactSection'
import { FaqSection } from '@/pages/landing/sections/FaqSection'
import { HowItWorks } from '@/pages/landing/sections/HowItWorks'
import { PromoSection } from '@/pages/landing/sections/PromoSection'
import { Ticker } from '@/pages/landing/sections/Ticker'
import { useInView } from '@/shared/lib/useInView'

/** Dados reais do catálogo (mesma fonte da homepage). Nenhum valor é inventado aqui. */
export function useProtoCatalog() {
  const { state, retry } = useCatalog()
  const ready = state.status === 'ready'
  const chopes = ready
    ? (state.catalog.expanded.categories.find((c) => c.id === 'chopes')?.items ?? [])
    : []
  const products = ready ? state.catalog.products : []
  const minPrice =
    products.length > 0 ? (lowestPrice(products, 50) ?? lowestPrice(products, 30)) : null
  return { state, retry, chopes, minPrice }
}

/** Seções oficiais abaixo da dobra, reutilizadas sem alteração para a página ficar navegável. */
export function ProtoLower({
  state,
  retry,
  finalCtaRef,
}: {
  state: CatalogState
  retry: () => void
  finalCtaRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <>
      <Ticker />
      <CatalogSection state={state} retry={retry} />
      <HowItWorks />
      <AboutSection />
      <PromoSection />
      <FaqSection />
      <ContactSection ctaRef={finalCtaRef} />
    </>
  )
}

export function useStickyVisibility(heroCta: RefObject<HTMLElement | null>) {
  const finalCtaRef = useRef<HTMLDivElement>(null)
  const heroInView = useInView(heroCta)
  const finalInView = useInView(finalCtaRef)
  return { finalCtaRef, stickyVisible: !heroInView && !finalInView }
}

export function ProtoSwitcher({ current }: { current: 'a' | 'b' | 'pastel' }) {
  const link = (href: string, label: string, active: boolean) => (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      style={{ color: active ? 'var(--color-gold-soft)' : 'var(--text-muted-green)' }}
    >
      {label}
    </a>
  )
  return (
    <nav
      aria-label="Alternar protótipo (somente desenvolvimento)"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem 1rem',
        justifyContent: 'center',
        padding: '1rem',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <span>Protótipo (dev):</span>
      {link('/__proto/a', 'A · Conceito C refinado', current === 'a')}
      {link('/__proto/b', 'B · Editorial imersivo', current === 'b')}
      {link('/__proto/pastel', 'Pastel Brewery', current === 'pastel')}
      {link('/', 'Homepage oficial', false)}
    </nav>
  )
}
