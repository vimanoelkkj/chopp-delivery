import { Faq } from '@/features/faq/Faq'
import { faqItems } from '@/features/faq/faq-items'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import styles from './FaqSection.module.css'

export function FaqSection() {
  return (
    <section id="faq" className={styles.section} aria-labelledby="faq-title">
      <Container className={styles.inner}>
        <SectionHeading eyebrow="05 · Dúvidas" id="faq-title">
          Perguntas
          <DesktopBreak />
          frequentes
        </SectionHeading>
        <Faq items={faqItems} />
      </Container>
    </section>
  )
}
