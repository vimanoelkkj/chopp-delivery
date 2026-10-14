import type { ElementType, ReactNode } from 'react'
import styles from './Container.module.css'

type ContainerProps = {
  as?: ElementType
  className?: string
  children: ReactNode
}

/** Largura máxima de 1280px com a margem lateral fluida do design. */
export function Container({ as: Tag = 'div', className, children }: ContainerProps) {
  return <Tag className={[styles.container, className].filter(Boolean).join(' ')}>{children}</Tag>
}
