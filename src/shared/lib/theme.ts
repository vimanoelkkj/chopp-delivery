export type ThemeMode = 'light' | 'dark'
export type ThemeSurface = 'storefront' | 'admin'
export type ThemePreference = ThemeMode | 'system'

/** Independent defaults. The storefront never consults the OS preference or browser storage. */
export const DEFAULT_THEME_MODES: Readonly<Record<ThemeSurface, ThemeMode>> = {
  storefront: 'light',
  admin: 'light',
}

/** The caller must explicitly opt in to `system`; only the admin panel does. */
export function resolveThemeMode(
  preference: ThemePreference,
  preferredMode: ThemeMode = 'light',
): ThemeMode {
  return preference === 'system' ? preferredMode : preference
}

export function themeAttributes(surface: ThemeSurface, mode = DEFAULT_THEME_MODES[surface]) {
  return { 'data-theme-surface': surface, 'data-color-mode': mode } as const
}

/** Admin-only persisted preference. The storefront and the CMS preview never read it. */
export const ADMIN_THEME_STORAGE_KEY = 'chopp.admin.theme'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'light'
export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

export function parseThemePreference(value: unknown): ThemePreference | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

/** Unavailable storage (privacy mode, blocked cookies, quota) or an invalid value yields null. */
export function readThemePreference(storage: ReadableStorage | null): ThemePreference | null {
  try {
    return parseThemePreference(storage?.getItem(ADMIN_THEME_STORAGE_KEY))
  } catch {
    return null
  }
}

export function writeThemePreference(
  storage: WritableStorage | null,
  preference: ThemePreference,
): boolean {
  try {
    storage?.setItem(ADMIN_THEME_STORAGE_KEY, preference)
    return Boolean(storage)
  } catch {
    return false
  }
}

/** Accessing `localStorage` itself can throw (blocked storage), so it is wrapped. */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const systemMode = (dark: boolean): ThemeMode => (dark ? 'dark' : 'light')

type MediaQueryLike = Pick<MediaQueryList, 'matches'> & {
  addEventListener?: MediaQueryList['addEventListener']
  removeEventListener?: MediaQueryList['removeEventListener']
  addListener?: MediaQueryList['addListener']
  removeListener?: MediaQueryList['removeListener']
}

export function systemQuery(): MediaQueryLike | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(SYSTEM_DARK_QUERY) : null
  } catch {
    return null
  }
}

/** Subscribes to OS changes (with the legacy Safari API as fallback); returns the unsubscribe. */
export function watchSystemDark(query: MediaQueryLike | null, onChange: (dark: boolean) => void) {
  if (!query) return () => {}
  const listener = (event: { matches: boolean }) => onChange(event.matches)
  if (query.addEventListener) {
    query.addEventListener('change', listener)
    return () => query.removeEventListener?.('change', listener)
  }
  query.addListener?.(listener)
  return () => query.removeListener?.(listener)
}
