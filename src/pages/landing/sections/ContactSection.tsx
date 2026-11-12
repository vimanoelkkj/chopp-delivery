import type { Ref } from 'react'
import { AgeNotice } from '@/features/compliance/AgeNotice'
import { contact, placeholders } from '@/features/contact/config'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { Container } from '@/shared/ui/Container'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './ContactSection.module.css'

type ContactSectionProps = {
  deliveryRegion?: string
  editorial?: CmsContentsV2['contact']
  /** Marca o CTA final para a página saber quando ele está na tela. */
  ctaRef?: Ref<HTMLDivElement>
}

export function ContactSection({ ctaRef, deliveryRegion, editorial }: ContactSectionProps) {
  return (
    <section id="contato" className={styles.section} aria-labelledby="contato-title">
      <Container className={styles.inner}>
        <div className={styles.row}>
          <h2 id="contato-title" className={styles.title}>
            {editorial?.heading ?? (
              <>
                Bora
                <br />
                <span className={styles.accent}>pedir?</span>
              </>
            )}
          </h2>
          <div className={styles.action} ref={ctaRef}>
            <p className={styles.text}>
              {editorial?.body ?? (
                <>Conte o que precisa e a gente responde com as opções e os valores.</>
              )}
            </p>
            <WhatsAppButton message="contact" size="lg">
              Chamar no WhatsApp
            </WhatsAppButton>
          </div>
        </div>
        <footer className={styles.footer}>
          <AgeNotice variant="footer" />
          <p className={styles.meta}>
            <span>
              {deliveryRegion ?? contact.address ?? placeholders.address}
              {contact.hours ? ` · ${contact.hours}` : ''}
            </span>
            {contact.instagram && <span>{contact.instagram}</span>}
            <span>Chopp Delivery Delegas</span>
          </p>
        </footer>
      </Container>
    </section>
  )
}
