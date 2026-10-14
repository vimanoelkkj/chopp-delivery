import type { Ref } from 'react'
import { AgeNotice } from '@/features/compliance/AgeNotice'
import { contact, placeholders } from '@/features/contact/config'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { Container } from '@/shared/ui/Container'
import styles from './ContactSection.module.css'

type ContactSectionProps = {
  /** Marca o CTA final para a página saber quando ele está na tela. */
  ctaRef?: Ref<HTMLDivElement>
}

export function ContactSection({ ctaRef }: ContactSectionProps) {
  const number = contact.whatsappNumber
  return (
    <section id="contato" className={styles.section} aria-labelledby="contato-title">
      <Container className={styles.inner}>
        <div className={styles.row}>
          <h2 id="contato-title" className={styles.title}>
            Bora
            <br />
            <span className={styles.accent}>pedir?</span>
          </h2>
          <div className={styles.action} ref={ctaRef}>
            <p className={styles.text}>
              Conte o que precisa e a gente responde com as opções e os valores.
            </p>
            <WhatsAppButton message="contact" size="lg">
              {number ? 'Chamar no WhatsApp' : `Chamar no WhatsApp · ${placeholders.whatsapp}`}
            </WhatsAppButton>
          </div>
        </div>
        <footer className={styles.footer}>
          <AgeNotice variant="footer" />
          <p className={styles.meta}>
            <span>
              {contact.address ?? placeholders.address} · {contact.hours ?? placeholders.hours}
            </span>
            <span>{contact.instagram ?? placeholders.instagram}</span>
            <span>Chopp Delivery Delegas</span>
          </p>
        </footer>
      </Container>
    </section>
  )
}
