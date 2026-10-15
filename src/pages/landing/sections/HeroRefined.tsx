import type { Ref } from 'react'
import { AgeNotice } from '@/features/compliance/AgeNotice'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { PhotoPlaceholder } from '@/shared/ui/PhotoPlaceholder'
import styles from './HeroRefined.module.css'

export type HeroRefinedProps = {
  /** Marca o bloco de CTAs para a página saber quando ele sai da tela. */
  ctaRef?: Ref<HTMLDivElement>
  /** Simulação de prefers-reduced-motion para fins de prévia ou testes. */
  forceReducedMotion?: boolean
}

/**
 * Refinamento visual do Hero (Alternativa de Movimento & Design Delegas F1).
 *
 * Características adicionadas:
 * 1. Glow âmbar discreto (radial-gradients suaves que aquecem o título e a tulipa);
 * 2. Textura sutil pontilhada sobre o fundo preto (evoca chope artesanal sem ruído pesado);
 * 3. Gradiente escuro com profundidade (preto vinílico a carvão quente);
 * 4. Entrada suave da tipografia (transform + opacity escalonados e acessíveis).
 */
export function HeroRefined({ ctaRef, forceReducedMotion = false }: HeroRefinedProps) {
  return (
    <section
      className={styles.hero}
      aria-labelledby="hero-title"
      data-reduced-motion={forceReducedMotion ? 'true' : undefined}
    >
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
          <div className={styles.compliance}>
            <AgeNotice variant="hero" />
          </div>
        </div>
      </Container>
    </section>
  )
}
