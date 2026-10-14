import styles from './Switch.module.css'

type SwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Nome acessível: o que o interruptor controla (o estado vem de aria-checked). */
  label: string
  onText: string
  offText: string
}

export function Switch({ checked, onChange, label, onText, offText }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      <span className={styles.text} aria-hidden="true">
        {checked ? onText : offText}
      </span>
    </button>
  )
}
