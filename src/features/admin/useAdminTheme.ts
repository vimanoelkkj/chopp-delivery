import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ADMIN_THEME_STORAGE_KEY,
  browserStorage,
  parseThemePreference,
  resolveThemeMode,
  systemMode,
  systemQuery,
  type ThemeMode,
  type ThemePreference,
  watchSystemDark,
  writeThemePreference,
} from '../../shared/lib/theme'
import { initialAdminPreference } from './adminTheme'

export type AdminThemeControl = {
  preference: ThemePreference
  mode: ThemeMode
  choose: (preference: ThemePreference) => void
}

/** Null fora do provedor (por exemplo, testes de renderização estática): o seletor não aparece. */
export const AdminThemeContext = createContext<AdminThemeControl | null>(null)
export const useAdminThemeControl = () => useContext(AdminThemeContext)

/**
 * Preferência do painel: salva localmente, resolve `system` pelo `prefers-color-scheme` e o
 * acompanha sem recarregar. Só o painel usa isto; a vitrine e a prévia CMS ficam claras.
 */
export function useAdminTheme(): AdminThemeControl {
  const [preference, setPreference] = useState(() =>
    initialAdminPreference(import.meta.env.DEV, window.location, browserStorage()),
  )
  const [systemDark, setSystemDark] = useState(() => Boolean(systemQuery()?.matches))

  useEffect(() => {
    if (preference !== 'system') return
    const query = systemQuery()
    setSystemDark(Boolean(query?.matches))
    return watchSystemDark(query, setSystemDark)
  }, [preference])

  // Outra aba do painel mudou a escolha.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ADMIN_THEME_STORAGE_KEY) return
      const next = parseThemePreference(event.newValue)
      if (next) setPreference(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next)
    writeThemePreference(browserStorage(), next)
  }, [])

  const mode = resolveThemeMode(preference, systemMode(systemDark))
  return useMemo(() => ({ preference, mode, choose }), [preference, mode, choose])
}
