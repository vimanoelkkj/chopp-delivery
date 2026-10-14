import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import styles from './Tabs.module.css'

export type TabItem<T extends string> = { id: T; label: string; count?: number }

type TabsProps<T extends string> = {
  label: string
  items: readonly TabItem<T>[]
  active: T
  onChange: (id: T) => void
  idPrefix: string
  children: ReactNode
}

/** Abas com teclado do padrão ARIA: setas, Home e End movem a seleção junto com o foco. */
export function Tabs<T extends string>({
  label,
  items,
  active,
  onChange,
  idPrefix,
  children,
}: TabsProps<T>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKeyDown = (event: KeyboardEvent) => {
    const index = items.findIndex((item) => item.id === active)
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: items.length - 1 }[
      event.key
    ]
    if (target === undefined) return
    event.preventDefault()
    const next = items[(target + items.length) % items.length]
    onChange(next.id)
    refs.current[next.id]?.focus()
  }

  return (
    <>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.id === active
          return (
            <button
              key={item.id}
              ref={(node) => {
                refs.current[item.id] = node
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={selected ? `${idPrefix}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => onChange(item.id)}
            >
              {item.label}
              {item.count === undefined ? null : <span className={styles.count}>{item.count}</span>}
            </button>
          )
        })}
      </div>
      <div
        key={active}
        role="tabpanel"
        id={`${idPrefix}-panel`}
        aria-labelledby={`${idPrefix}-tab-${active}`}
        className={styles.panel}
      >
        {children}
      </div>
    </>
  )
}
