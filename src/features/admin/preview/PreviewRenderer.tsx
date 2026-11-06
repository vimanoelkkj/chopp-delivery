import { type MouseEvent, type ReactNode, useState } from 'react'
import type { CmsModuleV2 } from '../../../../shared/cms/v2'
import pageStyles from '../../../pages/landing/LandingPage.module.css'
import { AboutSection } from '../../../pages/landing/sections/AboutSection'
import aboutStyles from '../../../pages/landing/sections/AboutSection.module.css'
import { BarrelsSection } from '../../../pages/landing/sections/BarrelsSection'
import { CatalogSection } from '../../../pages/landing/sections/CatalogSection'
import { ContactSection } from '../../../pages/landing/sections/ContactSection'
import { FaqSection } from '../../../pages/landing/sections/FaqSection'
import { Hero } from '../../../pages/landing/sections/Hero'
import { HowItWorks } from '../../../pages/landing/sections/HowItWorks'
import { PromoSection } from '../../../pages/landing/sections/PromoSection'
import { SiteHeader } from '../../../pages/landing/sections/SiteHeader'
import { Ticker } from '../../../pages/landing/sections/Ticker'
import type { CatalogState } from '../../catalog/useCatalog'
import { CommercialPreviewContext } from '../../contact/CommercialPreviewContext'
import { type MediaProfile, mediaPath } from '../mediaPath'
import { MediaFrame } from '../site/media/MediaFrame'
import { type PreviewDocument, previewCarousel } from './model'
import styles from './Preview.module.css'

const labels: Record<string, string> = {
  carousel: 'Barris 3D',
  catalog: 'Catálogo',
  how: 'Como funciona',
  faq: 'Dúvidas',
  contact: 'Contato',
}
function Placeholder() {
  return (
    <div role="img" aria-label="Mídia privada não carregada" className={styles.placeholder}>
      Mídia privada · Placeholder da prévia
    </div>
  )
}

/**
 * Imagem privada já SALVA no rascunho, entregue pela rota autenticada por ID e perfil (nunca por chave
 * de armazenamento). Ausente, em processamento, excluída ou corrompida: o servidor responde erro e a
 * prévia mostra o espaço reservado, sem quebrar a página. Use  para reiniciar ao trocar.
 */
function PreviewMedia({
  media,
  profile,
}: {
  media: { id: string; alt: string }
  profile: MediaProfile
}) {
  const [failed, setFailed] = useState(false)
  const path = mediaPath(media.id, profile)
  if (!path || failed) return <Placeholder />
  return (
    <img
      className={styles.media}
      src={path}
      alt={media.alt}
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

export function PreviewRenderer({
  value,
  catalog,
  retry,
}: {
  value: PreviewDocument
  catalog: CatalogState
  retry: () => void
}) {
  const { layout, document: doc } = value
  const blockNavigation = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest('a') : null
    const href = target?.getAttribute('href')
    if (target && (!href?.startsWith('#') || !document.getElementById(href.slice(1)))) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  const render = (module: CmsModuleV2, number: string | null): ReactNode => {
    const sectionNumber = number ?? undefined
    switch (module.template) {
      case 'hero':
        return (
          <Hero
            state={catalog}
            editorial={module.content}
            carouselHref={layout.heroCarouselHref}
            mediaFallback={
              module.content.media ? (
                <MediaFrame
                  key={module.content.media.id}
                  media={module.content.media}
                  profile="hero"
                  fit="contain"
                />
              ) : undefined
            }
          />
        )
      case 'carousel': {
        const selection = previewCarousel(module.content.entries, catalog)
        const media = new Map(
          module.content.entries.flatMap((entry) =>
            entry.media ? [[entry.itemId, entry.media] as const] : [],
          ),
        )
        return (
          <>
            {selection.unavailable.length > 0 && (
              <p role="status" className={styles.diagnostics}>
                Itens ausentes ou ocultos no catálogo: {selection.unavailable.join(', ')}
              </p>
            )}
            {module.content.media && (
              <p className={styles.diagnostics}>
                carousel.media preservada sem representação visual definida.
              </p>
            )}
            <BarrelsSection
              state={selection.state}
              editorial={module.content}
              sectionNumber={sectionNumber}
              renderItemMedia={(id) => {
                const ref = media.get(id)
                return ref ? <PreviewMedia key={ref.id} media={ref} profile="section" /> : undefined
              }}
            />
          </>
        )
      }
      case 'ticker':
        return <Ticker editorial={module.content} />
      case 'catalog':
        return (
          <CatalogSection
            state={catalog}
            retry={retry}
            editorial={module.content}
            sectionNumber={sectionNumber}
          />
        )
      case 'how':
        return <HowItWorks editorial={module.content} sectionNumber={sectionNumber} />
      case 'about':
        return (
          <AboutSection
            editorial={module.content}
            sectionNumber={sectionNumber}
            mediaFallback={
              module.content.media ? (
                <div className={aboutStyles.stage}>
                  <MediaFrame
                    key={module.content.media.id}
                    media={module.content.media}
                    profile="section"
                    fit="cover"
                  />
                </div>
              ) : undefined
            }
          />
        )
      case 'highlight':
        return (
          <>
            {module.content.media && (
              <PreviewMedia
                key={module.content.media.id}
                media={module.content.media}
                profile="section"
              />
            )}
            <PromoSection editorial={module.content} headingId={`${module.id}-title`} />
          </>
        )
      case 'faq':
        return <FaqSection editorial={module.content} sectionNumber={sectionNumber} />
      case 'contact':
        return <ContactSection editorial={module.content} />
    }
  }
  return (
    <CommercialPreviewContext value={true}>
      <div
        id="topo"
        className={pageStyles.page}
        onClickCapture={blockNavigation}
        onAuxClickCapture={blockNavigation}
      >
        <SiteHeader
          deliveryRegion={doc.modules.find((m) => m.template === 'hero')?.content.deliveryRegion}
          links={layout.navigation.map((link) => ({
            href: link.href,
            label: labels[link.template] ?? 'Seção',
          }))}
        />
        {layout.diagnostics.length > 0 && (
          <aside className={styles.diagnostics} aria-label="Diagnósticos do documento">
            {layout.diagnostics.map((d) => (
              <p key={`${d.code}-${d.index ?? ''}`}>{d.code}</p>
            ))}
          </aside>
        )}
        <main id="conteudo">
          {layout.sections.map((section) => {
            const module = doc.modules.find((m) => m.id === section.id)
            return module ? (
              <div
                key={module.id}
                id={module.id}
                className={styles.module}
                data-cms-template={module.template}
              >
                {render(module, section.number)}
              </div>
            ) : null
          })}
        </main>
      </div>
    </CommercialPreviewContext>
  )
}
