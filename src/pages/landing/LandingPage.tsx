import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { useCatalog } from '@/features/catalog/useCatalog'
import { WhatsAppNumberContext } from '@/features/contact/WhatsAppNumberContext'
import { usePublishedSite } from '@/features/site/usePublishedSite'
import { PASTEL_THEME, useDocumentTheme } from '@/shared/lib/documentTheme'
import { themeAttributes } from '@/shared/lib/theme'
import { EditorialSections } from './EditorialSections'
import styles from './LandingPage.module.css'
import { ContactSection } from './sections/ContactSection'
import { Hero } from './sections/Hero'
import { SiteHeader } from './sections/SiteHeader'
import { StickyCta } from './sections/StickyCta'
import { StorefrontThemeContext, useStorefrontTheme } from './useStorefrontTheme'
import { useVisibleOrderCta } from './useVisibleOrderCta'

export function LandingPage() {
  const theme = useStorefrontTheme()
  useDocumentTheme(PASTEL_THEME, theme.mode)
  const { state: catalogState, retry } = useCatalog()
  const editorial = usePublishedSite()
  const site = editorial.status === 'ready' ? editorial.site : null
  const hero = site?.document.modules.find((m) => m.template === 'hero')
  const contact = site?.document.modules.find((m) => m.template === 'contact')
  const labels = {
    carousel: 'Barris 3D',
    catalog: 'Catálogo',
    how: 'Como funciona',
    faq: 'Dúvidas',
  }
  const links = site?.layout.navigation
    .filter((link) => link.kind === 'primary')
    .map((link) => ({
      href: link.href,
      label: labels[link.template as keyof typeof labels],
    }))
  const status = {
    loading: 'Carregando conteúdo editorial. O catálogo continua disponível.',
    absent: 'Nenhuma publicação editorial. Exibindo a apresentação padrão.',
    error: 'Conteúdo editorial indisponível. Exibindo a apresentação padrão.',
    ready:
      'Conteúdo publicado carregado. Imagens padrão preservadas quando a editorial não carrega.',
  }[editorial.status]
  const mainRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const orderCtaInView = useVisibleOrderCta(mainRef, headerHeight)

  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const measure = () => setHeaderHeight(Math.ceil(header.getBoundingClientRect().height))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  return (
    <WhatsAppNumberContext value={site?.document.commercial.whatsappNumber ?? null}>
      <StorefrontThemeContext value={theme}>
        <div
          {...themeAttributes('storefront', theme.mode)}
          id="topo"
          className={styles.page}
          data-editorial-state={editorial.status}
          style={
            headerHeight
              ? ({ '--storefront-header-height': `${headerHeight}px` } as CSSProperties)
              : undefined
          }
        >
          <SiteHeader
            headerRef={headerRef}
            links={links}
            deliveryRegion={hero?.content.deliveryRegion}
          />
          <p className={styles.editorialStatus} role="status" aria-live="polite" aria-atomic="true">
            {status}
          </p>
          <main id="conteudo" ref={mainRef}>
            <Hero
              state={catalogState}
              editorial={hero?.content}
              publishedMedia={hero?.content.media}
              carouselHref={site ? site.layout.heroCarouselHref : undefined}
            />
            <EditorialSections
              site={site}
              catalog={catalogState}
              retry={retry}
              settled={editorial.status !== 'loading'}
            />
            <ContactSection
              deliveryRegion={hero?.content.deliveryRegion}
              editorial={contact?.content}
            />
          </main>
          <StickyCta visible={!orderCtaInView} />
        </div>
      </StorefrontThemeContext>
    </WhatsAppNumberContext>
  )
}
