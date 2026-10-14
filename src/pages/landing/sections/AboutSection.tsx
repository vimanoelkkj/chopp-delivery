import { Container } from '@/shared/ui/Container'
import { DesktopBreak } from '@/shared/ui/DesktopBreak'
import { PhotoPlaceholder } from '@/shared/ui/PhotoPlaceholder'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import styles from './AboutSection.module.css'

/** Texto institucional ainda não existe: parágrafo é placeholder do design. */
export function AboutSection() {
  return (
    <section id="sobre" className={styles.section} aria-labelledby="sobre-title">
      <Container className={styles.inner}>
        <div className={styles.copy}>
          <SectionHeading eyebrow="04 · Sobre" id="sobre-title">
            Quem
            <DesktopBreak />
            entrega
          </SectionHeading>
          <p className={styles.text}>
            [Texto da história da empresa, desde quando atende, bairros e cidades atendidas.
            Aguardando informações do estabelecimento.]
          </p>
        </div>
        <PhotoPlaceholder className={styles.photo} caption="equipe ou loja" />
      </Container>
    </section>
  )
}
