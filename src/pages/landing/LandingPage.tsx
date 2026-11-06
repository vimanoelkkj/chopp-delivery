import { useRef } from 'react'
import { useCatalog } from '@/features/catalog/useCatalog'
import { WhatsAppNumberContext } from '@/features/contact/WhatsAppNumberContext'
import { usePublishedSite } from '@/features/site/usePublishedSite'
import { PASTEL_THEME, useDocumentTheme } from '@/shared/lib/documentTheme'
import { themeAttributes } from '@/shared/lib/theme'
import { useInView } from '@/shared/lib/useInView'
import { EditorialSections } from './EditorialSections'
import styles from './LandingPage.module.css'
import { ContactSection } from './sections/ContactSection'
import { Hero } from './sections/Hero'
import { SiteHeader } from './sections/SiteHeader'
import { StickyCta } from './sections/StickyCta'

export function LandingPage() {
  useDocumentTheme(PASTEL_THEME)
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
  const heroCtaRef = useRef<HTMLDivElement>(null)
  const finalCtaRef = useRef<HTMLDivElement>(null)
  const heroCtaInView = useInView(heroCtaRef)
  const finalCtaInView = useInView(finalCtaRef)

  return (
    <WhatsAppNumberContext value={site?.document.commercial.whatsappNumber ?? null}>
      <div
        {...themeAttributes('storefront')}
        id="topo"
        className={styles.page}
        data-editorial-state={editorial.status}
      >
        <SiteHeader links={links} deliveryRegion={hero?.content.deliveryRegion} />
        <p className={styles.editorialStatus} role="status" aria-live="polite" aria-atomic="true">
          {status}
        </p>
        <main id="conteudo">
          <Hero
            state={catalogState}
            ctaRef={heroCtaRef}
            editorial={hero?.content}
            publishedMedia={hero?.content.media}
            carouselHref={site ? site.layout.heroCarouselHref : undefined}
          />
          <EditorialSections site={site} catalog={catalogState} retry={retry} />
          <ContactSection ctaRef={finalCtaRef} editorial={contact?.content} />
        </main>
        <StickyCta visible={!heroCtaInView && !finalCtaInView} />
      </div>
    </WhatsAppNumberContext>
  )
}
