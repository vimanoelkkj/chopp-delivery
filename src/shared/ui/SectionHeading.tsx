import type { ReactNode } from 'react'
import styles from './SectionHeading.module.css'

type SectionHeadingProps = {
  eyebrow: string
  id?: string
  large?: boolean
  children: ReactNode
}

/** Rótulo mono em dourado + título de seção (h2) em display condensado. */
export function SectionHeading({ eyebrow, id, large, children }: SectionHeadingProps) {
  return (
    <div className={styles.heading}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2 id={id} className={[styles.title, large ? styles.large : ''].filter(Boolean).join(' ')}>
        {children}
      </h2>
    </div>
  )
}
