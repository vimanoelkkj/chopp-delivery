import styles from './PhotoPlaceholder.module.css'

type PhotoPlaceholderProps = {
  /** Descrição da foto que deve entrar aqui. Aparece no placeholder. */
  caption: string
  glow?: boolean
  className?: string
}

/** Espaço reservado para foto real. Sai de cena quando as fotos chegarem. */
export function PhotoPlaceholder({ caption, glow, className }: PhotoPlaceholderProps) {
  return (
    <div
      role="img"
      aria-label={`Espaço reservado para foto: ${caption}`}
      className={[styles.photo, glow ? styles.glow : '', className ?? ''].filter(Boolean).join(' ')}
    >
      <span className={styles.caption}>[Foto] {caption}</span>
    </div>
  )
}
