import type { Ref } from 'react'
import { AgeNotice } from '@/features/compliance/AgeNotice'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { PhotoPlaceholder } from '@/shared/ui/PhotoPlaceholder'
import styles from './Hero.module.css'

type HeroProps = {
  /** Marca o bloco de CTAs para a página saber quando ele sai da tela. */
  ctaRef?: Ref<HTMLDivElement>
}

export function Hero({ ctaRef }: HeroProps) {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <Container className={styles.grid}>
        <p className={styles.eyebrow}>Delivery · Barris 30 e 50 L</p>
        <h1 id="hero-title" className={styles.title}>
          Chope
          <br />
          gelado
          <br />
          <span className={styles.accent}>
            na
            <DesktopBreak />
            porta.
          </span>
        </h1>
        <PhotoPlaceholder
          glow
          className={styles.photo}
          caption="chope tulipa, espuma cremosa, fundo preto, luz lateral quente"
        />
        <div className={styles.lead}>
          <p className={styles.text}>
            Escolha o chope, o tamanho do barril e o horário. A gente entrega.
          </p>
          <div className={styles.actions} ref={ctaRef}>
            <WhatsAppButton message="order">Pedir no WhatsApp</WhatsAppButton>
            <Button href="#chopes" variant="outline">
              Ver os chopes
            </Button>
          </div>
          <AgeNotice variant="hero" />
        </div>
      </Container>
    </section>
  )
}
