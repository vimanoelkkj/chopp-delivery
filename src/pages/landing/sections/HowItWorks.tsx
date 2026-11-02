import { Container } from '@/shared/ui/Container'
import type { CmsContentsV2 } from '../../../../shared/cms/v2'
import styles from './HowItWorks.module.css'

const steps = [
  {
    title: 'Escolha o Chopp',
    text: 'Selecione o estilo e a cervejaria desejada, definindo entre 30L ou 50L conforme o número de convidados.',
  },
  {
    title: 'Dados & Tomada',
    text: 'Informe data, horário, endereço do evento e se a tomada disponível é 110V ou 220V para a chopeira.',
  },
  {
    title: 'Instalação Inclusa',
    text: 'Nossa equipe posiciona o barril, liga a chopeira elétrica profissional, calibra o CO2 e deixa tudo pronto.',
  },
  {
    title: 'Aproveite o Chopp',
    text: 'Chopp sempre gelado do primeiro ao último copo. Após o evento, nós recolhemos o equipamento sem complicações.',
  },
]

export function HowItWorks({
  editorial,
  sectionNumber,
}: {
  editorial?: CmsContentsV2['how']
  sectionNumber?: string
} = {}) {
  const visibleSteps = editorial?.steps.map(({ title, body }) => ({ title, text: body })) ?? steps
  const occurrences = new Map<string, number>()
  return (
    <section id="como" className={styles.section} aria-labelledby="como-title">
      <Container className={styles.inner}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>{sectionNumber ?? '03'} • Sem Complicações</p>
          <h2 id="como-title" className={styles.title}>
            {editorial?.heading ?? <>Como Funciona a Entrega</>}
          </h2>
          <p className={styles.lead}>
            Operação exclusivamente por delivery. Levamos o barril gelado, conectamos a chopeira
            elétrica e deixamos pronta para o brinde.
          </p>
        </div>

        <ol className={styles.stepsGrid}>
          {visibleSteps.map((step, index) => {
            const occurrence = (occurrences.get(step.title) ?? 0) + 1
            occurrences.set(step.title, occurrence)
            return (
              <li key={`${step.title}-${occurrence}`} className={styles.stepCard}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepText}>{step.text}</p>
              </li>
            )
          })}
        </ol>
      </Container>
    </section>
  )
}
