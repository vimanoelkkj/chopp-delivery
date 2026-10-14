import { useRef } from 'react'
import { useInView } from '@/shared/lib/useInView'
import styles from './LandingPage.module.css'
import { AboutSection } from './sections/AboutSection'
import { BarrelsSection } from './sections/BarrelsSection'
import { CatalogSection } from './sections/CatalogSection'
import { ContactSection } from './sections/ContactSection'
import { FaqSection } from './sections/FaqSection'
import { Hero } from './sections/Hero'
import { HowItWorks } from './sections/HowItWorks'
import { PromoSection } from './sections/PromoSection'
import { SiteHeader } from './sections/SiteHeader'
import { StickyCta } from './sections/StickyCta'
import { Ticker } from './sections/Ticker'

export function LandingPage() {
  const heroCtaRef = useRef<HTMLDivElement>(null)
  const finalCtaRef = useRef<HTMLDivElement>(null)
  const heroCtaInView = useInView(heroCtaRef)
  const finalCtaInView = useInView(finalCtaRef)

  return (
    <div id="topo" className={styles.page}>
      <SiteHeader />
      <main id="conteudo">
        <Hero ctaRef={heroCtaRef} />
        <Ticker />
        <CatalogSection />
        <BarrelsSection />
        <HowItWorks />
        <PromoSection />
        <AboutSection />
        <FaqSection />
        <ContactSection ctaRef={finalCtaRef} />
      </main>
      <StickyCta visible={!heroCtaInView && !finalCtaInView} />
    </div>
  )
}
