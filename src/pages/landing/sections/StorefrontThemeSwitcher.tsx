import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { ThemePreference } from '@/shared/lib/theme'
import { useStorefrontThemeControl } from '../useStorefrontTheme'
import styles from './StorefrontThemeSwitcher.module.css'

const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

const OPTIONS: { value: ThemePreference; label: string; glyph: ReactNode }[] = [
  {
    value: 'light',
    label: 'Claro',
    glyph: icon(
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </>,
    ),
  },
  {
    value: 'dark',
    label: 'Escuro',
    glyph: icon(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />),
  },
  {
    value: 'system',
    label: 'Sistema',
    glyph: icon(
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>,
    ),
  },
]

/** Tema da vitrine: Claro, Escuro ou Sistema. Só aparece dentro do provedor da vitrine pública. */
export function StorefrontThemeSwitcher({ onOpen }: { onOpen?: () => void } = {}) {
  const control = useStorefrontThemeControl()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLFieldSetElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const initialFocus = useRef(0)
  const menuId = useId()
  const triggerId = useId()

  useEffect(() => {
    if (!open) return
    items.current[initialFocus.current]?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  if (!control) return null
  const selected = OPTIONS.find((option) => option.value === control.preference) ?? OPTIONS[0]
  const showMenu = (index: number) => {
    initialFocus.current = index
    onOpen?.()
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <fieldset
      ref={root}
      className={styles.group}
      aria-label="Tema da página"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
    >
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        className={styles.trigger}
        aria-label={`Tema da página: ${selected.label}`}
        title={`Tema da página: ${selected.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) setOpen(false)
          else showMenu(OPTIONS.indexOf(selected))
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (open) items.current[event.key === 'ArrowDown' ? 0 : OPTIONS.length - 1]?.focus()
            else showMenu(event.key === 'ArrowDown' ? 0 : OPTIONS.length - 1)
          }
        }}
      >
        {selected.glyph}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className={styles.menu}
          onKeyDown={(event) => {
            const current = items.current.indexOf(document.activeElement as HTMLButtonElement)
            const next = {
              ArrowDown: (current + 1) % OPTIONS.length,
              ArrowUp: (current + OPTIONS.length - 1) % OPTIONS.length,
              Home: 0,
              End: OPTIONS.length - 1,
            }[event.key]
            if (next !== undefined) {
              event.preventDefault()
              items.current[next]?.focus()
            }
          }}
        >
          {OPTIONS.map(({ value, label, glyph }, index) => (
            <button
              key={value}
              ref={(node) => {
                items.current[index] = node
              }}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              className={styles.option}
              aria-checked={control.preference === value}
              onClick={() => {
                control.choose(value)
                close()
              }}
            >
              {glyph}
              {label}
              <span className={styles.check} aria-hidden="true">
                {control.preference === value ? icon(<path d="m5 12 4 4L19 6" />) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </fieldset>
  )
}
