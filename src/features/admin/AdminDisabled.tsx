import { useEffect } from 'react'
import styles from './AdminDisabled.module.css'

/** /admin no build publicável enquanto o gateway real não está conectado. Não importa nada do painel. */
export default function AdminDisabled() {
  useEffect(() => {
    const previous = document.title
    document.title = 'Painel Delegas'
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.append(robots)
    return () => {
      document.title = previous
      robots.remove()
    }
  }, [])

  return (
    <main className={styles.root}>
      <h1 className={styles.title}>Painel indisponível</h1>
      <p>
        O painel administrativo ainda não está disponível. Nenhuma alteração pode ser feita por
        aqui.
      </p>
      <a href="/">Voltar ao site</a>
    </main>
  )
}
