import seal from '@/assets/admin-seal.png'
import styles from './BootSplash.module.css'

/** Abertura do painel: selo pulsando e barra dourada. Só aparece se passar de meio segundo. */
export function BootSplash({ label = 'Verificando acesso' }: { label?: string }) {
  return (
    <div className={styles.splash} role="status">
      <img className={styles.seal} src={seal} width="96" height="96" alt="" />
      <div className={styles.bar} aria-hidden="true" />
      <p className={styles.label}>{label}</p>
    </div>
  )
}
