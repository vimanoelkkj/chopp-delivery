import { Container } from '@/shared/ui/Container'
import typography from './BenefitsSection.module.css'
import styles from './ChoppIntroSection.module.css'

const advantages = [
  { title: 'Praticidade', text: 'Sirva diretamente da chopeira, conforme a necessidade.' },
  {
    title: 'Menos embalagens',
    text: 'Reduz a necessidade de garrafas e latas individuais durante o evento.',
  },
  { title: 'Experiência', text: 'Uma chopeira disponível para servir os convidados.' },
]

export function ChoppIntroSection() {
  return (
    <section id="por-que-chopp" aria-labelledby="por-que-chopp-title" className={styles.section}>
      <Container className={styles.inner}>
        <div>
          <h2 id="por-que-chopp-title" className={typography.title}>
            Por que escolher chopp para seu evento?
          </h2>
          <p className={typography.text}>
            Chopp é uma cerveja servida diretamente do barril por meio de uma chopeira. Uma opção
            prática para quem deseja servir seus convidados durante festas e comemorações.
          </p>
        </div>
        <dl className={styles.list}>
          {advantages.map((advantage) => (
            <div key={advantage.title}>
              <dt className={typography.cardTitle}>{advantage.title}</dt>
              <dd className={typography.text}>{advantage.text}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  )
}
