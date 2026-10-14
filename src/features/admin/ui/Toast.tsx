import styles from './Toast.module.css'

export type ToastState = { id: number; kind: 'success' | 'error'; message: string } | null

/**
 * Aviso curto de resultado. Sucesso é anunciado de forma educada (status); erro, de forma
 * imediata (alert). O `key` reinicia a animação a cada novo aviso.
 */
export function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null
  const error = toast.kind === 'error'
  return (
    <div
      key={toast.id}
      className={[styles.toast, error ? styles.error : styles.success].join(' ')}
      role={error ? 'alert' : 'status'}
    >
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        {error ? (
          <path d="M12 6v7M12 17.5v.5" pathLength="1" />
        ) : (
          <path d="m5 12.5 4.5 4.5L19 7.5" pathLength="1" />
        )}
      </svg>
      <span>{toast.message}</span>
    </div>
  )
}
