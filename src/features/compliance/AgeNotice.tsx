import styles from './AgeNotice.module.css'

type AgeNoticeProps = {
  /** `hero` fica discreto junto do primeiro CTA; `footer` acompanha o rodapé. */
  variant?: 'hero' | 'footer'
}

/** Aviso fixo de venda para maiores de 18 anos e consumo responsável. Não bloqueia a navegação. */
export function AgeNotice({ variant = 'hero' }: AgeNoticeProps) {
  return (
    <p className={[styles.notice, styles[variant]].join(' ')} data-testid={`age-notice-${variant}`}>
      <span className={styles.badge} aria-hidden="true">
        18+
      </span>
      <span>Venda proibida para menores de 18 anos. Beba com moderação.</span>
    </p>
  )
}
