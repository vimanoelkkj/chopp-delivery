import {
  browserStorage,
  DEFAULT_THEME_MODES,
  DEFAULT_THEME_PREFERENCE,
  readThemePreference,
  resolveThemeMode,
  systemMode,
  systemQuery,
  type ThemeMode,
  type ThemePreference,
} from '../../shared/lib/theme'

/** Explicit loopback-only DEV preview. Release builds always keep the existing default. */
export function adminPreviewTheme(
  development: boolean,
  location: Pick<Location, 'hostname' | 'search'>,
): ThemeMode {
  return development &&
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) &&
    new URLSearchParams(location.search).get('adminTheme') === 'dark'
    ? 'dark'
    : DEFAULT_THEME_MODES.admin
}

/**
 * Preference at startup: a saved choice wins; otherwise the DEV-only loopback override;
 * otherwise light (the historical default). Invalid saved values are ignored.
 */
export function initialAdminPreference(
  development: boolean,
  location: Pick<Location, 'hostname' | 'search'>,
  storage: Parameters<typeof readThemePreference>[0],
): ThemePreference {
  return (
    readThemePreference(storage) ??
    (adminPreviewTheme(development, location) === 'dark' ? 'dark' : DEFAULT_THEME_PREFERENCE)
  )
}

/**
 * Marks <html> before React renders so the first paint of /admin already has the final palette.
 * Admin screens release it through useDocumentTheme; nothing is applied outside /admin.
 */
export function applyEarlyAdminTheme(
  root: HTMLElement,
  location: Pick<Location, 'hostname' | 'search' | 'pathname'>,
  development: boolean,
) {
  if (!/^\/admin(\/|$)/.test(location.pathname)) return
  // The CMS preview frame is a storefront surface: it stays light whatever the admin preference.
  if (/^\/admin\/preview\/frame\/?$/.test(location.pathname)) return
  const preference = initialAdminPreference(development, location, browserStorage())
  const mode = resolveThemeMode(preference, systemMode(Boolean(systemQuery()?.matches)))
  root.dataset.theme = 'admin'
  root.dataset.themeSurface = 'admin'
  root.dataset.colorMode = mode
}
