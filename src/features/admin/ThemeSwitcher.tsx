import type { ReactNode } from 'react'
import type { ThemePreference } from '../../shared/lib/theme'
import styles from './ThemeSwitcher.module.css'
import { useAdminThemeControl } from './useAdminTheme'

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

/** Escolha de tema do painel: três botões de alternância com rótulo acessível e alvo de 44 px. */
export function ThemeSwitcher() {
  const control = useAdminThemeControl()
  if (!control) return null
  return (
    <fieldset className={styles.group} aria-label="Tema do painel">
      {OPTIONS.map(({ value, label, glyph }) => (
        <button
          key={value}
          type="button"
          className={styles.option}
          aria-pressed={control.preference === value}
          aria-label={label}
          title={label}
          onClick={() => control.choose(value)}
        >
          {glyph}
        </button>
      ))}
    </fieldset>
  )
}
