import { Container } from '@/shared/ui/Container'
import { SectionHeading } from '@/shared/ui/SectionHeading'
import styles from './HowItWorks.module.css'

const steps = [
  {
    title: 'Escolha o chope',
    text: 'Marca e estilo que combinam com a ocasião.',
  },
  {
    title: 'Defina o barril',
    text: '30 ou 50 litros, conforme o número de convidados.',
  },
  {
    title: 'Combine no WhatsApp',
    text: 'Data, endereço e forma de pagamento.',
  },
  {
    title: 'Receba e sirva',
    text: 'Informe se há escadas e se a tomada é 110 V ou 220 V.',
  },
]

export function HowItWorks() {
  return (
    <section id="como" className={styles.section} aria-labelledby="como-title">
      <Container className={styles.inner}>
        <SectionHeading eyebrow="03 · Como funciona" id="como-title">
          Quatro passos
        </SectionHeading>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.number} aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className={styles.title}>{step.title}</h3>
              <p className={styles.text}>{step.text}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  )
}
