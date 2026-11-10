import type { CatalogState } from '@/features/catalog/useCatalog'
import { type PublishedSite, selectEditorialCarousel } from '@/features/site/api'
import { AboutSection } from './sections/AboutSection'
import { BarrelsSection } from './sections/BarrelsSection'
import { CatalogSection } from './sections/CatalogSection'
import { FaqSection } from './sections/FaqSection'
import { HowItWorks } from './sections/HowItWorks'
import { PromoSection } from './sections/PromoSection'
import { Ticker } from './sections/Ticker'

export function EditorialSections({
  site,
  catalog,
  retry,
}: {
  site: PublishedSite | null
  catalog: CatalogState
  retry: () => void
}) {
  if (!site)
    return (
      <>
        <BarrelsSection state={catalog} />
        <Ticker />
        <CatalogSection state={catalog} retry={retry} />
        <HowItWorks />
        <AboutSection />
        <PromoSection />
        <FaqSection />
      </>
    )
  return site.layout.sections.map((section) => {
    const module = site.document.modules.find((m) => m.id === section.id)
    if (!module) return null
    const sectionNumber = section.number ?? undefined
    // Hero/about resolve published media via the shared helper; local assets stay as fallback.
    // carousel.media (module level) and highlight media have no defined visual role and stay unused;
    // carousel.entries[].media is resolved by itemId and shown on that product's card.
    switch (module.template) {
      case 'hero':
      case 'contact':
        return null
      case 'carousel': {
        // Por itemId, nunca por posição. Se o id se repetir, vale a primeira entrada.
        const entryMedia = new Map<string, { id: string; alt: string }>()
        for (const entry of module.content.entries)
          if (entry.media && !entryMedia.has(entry.itemId))
            entryMedia.set(entry.itemId, entry.media)
        return (
          <BarrelsSection
            key={module.id}
            state={selectEditorialCarousel(module.content.entries, catalog)}
            editorial={module.content}
            sectionNumber={sectionNumber}
            publishedMedia={(id) => entryMedia.get(id)}
          />
        )
      }
      case 'ticker':
        return <Ticker key={module.id} editorial={module.content} />
      case 'catalog':
        return (
          <CatalogSection
            key={module.id}
            state={catalog}
            retry={retry}
            editorial={module.content}
            sectionNumber={sectionNumber}
          />
        )
      case 'how':
        return (
          <HowItWorks key={module.id} editorial={module.content} sectionNumber={sectionNumber} />
        )
      case 'about':
        return (
          <AboutSection
            key={module.id}
            editorial={module.content}
            publishedMedia={module.content.media}
            sectionNumber={sectionNumber}
          />
        )
      case 'highlight':
        return (
          <PromoSection
            key={module.id}
            editorial={module.content}
            headingId={`${module.id}-title`}
          />
        )
      case 'faq':
        return (
          <FaqSection key={module.id} editorial={module.content} sectionNumber={sectionNumber} />
        )
    }
    return null
  })
}
