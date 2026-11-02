import { Faq } from '@/features/faq/Faq'
import { faqItems } from '@/features/faq/faq-items'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './FaqSection.module.css'

export function FaqSection({
  editorial,
  sectionNumber,
}: {
  editorial?: CmsContentsV2['faq']
  sectionNumber?: string
} = {}) {
  const items =
    editorial?.items.map((item, index) => ({ ...item, id: `editorial-faq-${index + 1}` })) ??
    faqItems
  return (
    <section id="faq" className={styles.section} aria-labelledby="faq-title">
      <Container className={styles.inner}>
        <SectionHeading eyebrow={`${sectionNumber ?? '05'} · Dúvidas`} id="faq-title">
          {editorial?.heading ?? (
            <>
              Perguntas
              <DesktopBreak />
              frequentes
            </>
          )}
        </SectionHeading>
        <Faq items={items} />
      </Container>
    </section>
  )
}
