import { Container } from '@/shared/ui/Container'
import styles from './BenefitsSection.module.css'

const benefits = [
  {
    title: 'Copos descartáveis inclusos',
    text: 'Fornecemos de 50 a 100 copos descartáveis, conforme a necessidade combinada para seu evento.',
    icon: 'M5 4h14l-2 16H7L5 4Zm1 5h12',
  },
  {
    title: 'Entrega e instalação',
    text: 'Nossa equipe entrega o pedido e instala a chopeira.',
    icon: 'M3 6h11v11H3V6Zm11 4h4l3 4v3h-7M5 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0Zm11 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0Z',
  },
  {
    title: 'Atendimento rápido',
    text: 'Atendimento ágil e direto para combinar seu pedido.',
    icon: 'M21 11a8 8 0 0 1-8 8H7l-4 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8ZM7 9h10M7 13h6',
  },
  {
    title: 'Variedade',
    text: 'Oito marcas de chopp para você escolher no catálogo.',
    icon: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  },
]

export function BenefitsSection() {
  return (
    <section id="diferenciais" aria-labelledby="diferenciais-title" className={styles.section}>
      <Container>
        <h2 id="diferenciais-title" className={styles.title}>
          Diferenciais da Delegas
        </h2>
        <ul className={styles.grid}>
          {benefits.map((benefit) => (
            <li key={benefit.title} className={styles.card}>
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 24 24"
                width="28"
                height="28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.icon}
              >
                <path d={benefit.icon} />
              </svg>
              <h3 className={styles.cardTitle}>{benefit.title}</h3>
              <p className={styles.text}>{benefit.text}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}
