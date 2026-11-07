import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  browserStorage,
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  readThemePreference,
  resolveThemeMode,
  STOREFRONT_THEME_STORAGE_KEY,
  systemMode,
  systemQuery,
  type ThemeMode,
  type ThemePreference,
  watchSystemDark,
  writeThemePreference,
} from '@/shared/lib/theme'

export type StorefrontThemeControl = {
  preference: ThemePreference
  mode: ThemeMode
  choose: (preference: ThemePreference) => void
}

/** Null fora da vitrine pública (por exemplo, na prévia CMS): o seletor não aparece. */
export const StorefrontThemeContext = createContext<StorefrontThemeControl | null>(null)
export const useStorefrontThemeControl = () => useContext(StorefrontThemeContext)

/**
 * Preferência do visitante: salva localmente em `chopp.storefront.theme`, claro por padrão,
 * `system` acompanha o `prefers-color-scheme` e outras abas sincronizam pelo evento `storage`.
 * Independente do painel (outra chave) e da prévia CMS, que nunca usa este hook.
 */
export function useStorefrontTheme(): StorefrontThemeControl {
  const [preference, setPreference] = useState<ThemePreference>(
    () =>
      readThemePreference(browserStorage(), STOREFRONT_THEME_STORAGE_KEY) ??
      DEFAULT_THEME_PREFERENCE,
  )
  const [systemDark, setSystemDark] = useState(() => Boolean(systemQuery()?.matches))

  useEffect(() => {
    if (preference !== 'system') return
    const query = systemQuery()
    setSystemDark(Boolean(query?.matches))
    return watchSystemDark(query, setSystemDark)
  }, [preference])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STOREFRONT_THEME_STORAGE_KEY) return
      setPreference(parseThemePreference(event.newValue) ?? DEFAULT_THEME_PREFERENCE)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next)
    writeThemePreference(browserStorage(), next, STOREFRONT_THEME_STORAGE_KEY)
  }, [])

  const mode = resolveThemeMode(preference, systemMode(systemDark))
  return useMemo(() => ({ preference, mode, choose }), [preference, mode, choose])
}
