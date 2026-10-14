import type { ButtonHTMLAttributes } from 'react'
import styles from './AdminButton.module.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'gold' | 'outline' | 'cream'
  /** Mostra o giro e ignora cliques sem perder o foco (um `disabled` de verdade o perderia). */
  pending?: boolean
}

export function AdminButton({
  variant = 'gold',
  pending,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      type={type}
      className={[styles.button, styles[variant], pending ? styles.pending : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
    >
      {pending ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  )
}
