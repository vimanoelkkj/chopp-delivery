import { describe, expect, it } from 'vitest'
import {
  ADMIN_THEME_STORAGE_KEY,
  DEFAULT_THEME_MODES,
  parseThemePreference,
  readThemePreference,
  resolveThemeMode,
  STOREFRONT_THEME_STORAGE_KEY,
  themeAttributes,
  watchSystemDark,
  writeThemePreference,
} from './theme'

describe('scoped theme configuration', () => {
  it('preserves light defaults independently for the storefront and admin', () => {
    expect(DEFAULT_THEME_MODES).toEqual({ storefront: 'light', admin: 'light' })
    expect(themeAttributes('storefront')).toEqual({
      'data-theme-surface': 'storefront',
      'data-color-mode': 'light',
    })
    expect(themeAttributes('admin')).toEqual({
      'data-theme-surface': 'admin',
      'data-color-mode': 'light',
    })
  })
  it('allows a dark surface without changing the other default or a nested preview', () => {
    expect(themeAttributes('admin', 'dark')['data-color-mode']).toBe('dark')
    expect(themeAttributes('storefront')['data-color-mode']).toBe('light')
    expect(themeAttributes('storefront', 'dark')['data-color-mode']).toBe('dark')
    expect(themeAttributes('admin')['data-color-mode']).toBe('light')
  })
  it('ignores the system preference unless the caller explicitly requests system', () => {
    expect(resolveThemeMode('light', 'dark')).toBe('light')
    expect(resolveThemeMode('dark', 'light')).toBe('dark')
    expect(resolveThemeMode('system', 'dark')).toBe('dark')
    expect(resolveThemeMode('system', 'light')).toBe('light')
  })
})

describe('persisted admin preference', () => {
  const store = (initial?: string) => {
    const data = new Map<string, string>(initial ? [[ADMIN_THEME_STORAGE_KEY, initial]] : [])
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    }
  }
  it('accepts only the three known values', () => {
    for (const value of ['light', 'dark', 'system']) expect(parseThemePreference(value)).toBe(value)
    for (const value of ['', 'DARK', 'auto', null, undefined, 1, {}])
      expect(parseThemePreference(value)).toBeNull()
  })
  it('round-trips and ignores invalid saved values', () => {
    const s = store()
    expect(readThemePreference(s)).toBeNull()
    expect(writeThemePreference(s, 'system')).toBe(true)
    expect(readThemePreference(s)).toBe('system')
    expect(readThemePreference(store('sepia'))).toBeNull()
  })
  it('survives unavailable or throwing storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readThemePreference(broken)).toBeNull()
    expect(writeThemePreference(broken, 'dark')).toBe(false)
    expect(readThemePreference(null)).toBeNull()
    expect(writeThemePreference(null, 'dark')).toBe(false)
  })
  it('watches system changes with modern and legacy APIs and unsubscribes', () => {
    const seen: boolean[] = []
    let modern: ((e: { matches: boolean }) => void) | undefined
    const stop = watchSystemDark(
      {
        matches: false,
        addEventListener: ((_: string, l: never) => {
          modern = l
        }) as never,
        removeEventListener: (() => {
          modern = undefined
        }) as never,
      },
      (dark) => seen.push(dark),
    )
    modern?.({ matches: true })
    stop()
    expect(seen).toEqual([true])
    expect(modern).toBeUndefined()
    let legacy: ((e: { matches: boolean }) => void) | undefined
    const stopLegacy = watchSystemDark(
      {
        matches: false,
        addListener: ((l: never) => {
          legacy = l
        }) as never,
        removeListener: (() => {
          legacy = undefined
        }) as never,
      },
      (dark) => seen.push(dark),
    )
    legacy?.({ matches: false })
    stopLegacy()
    expect(seen).toEqual([true, false])
    expect(watchSystemDark(null, () => {})).toBeTypeOf('function')
  })
})

describe('storefront preference key', () => {
  const store = () => {
    const data = new Map<string, string>()
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    }
  }
  it('uses its own key and never touches the admin one', () => {
    const s = store()
    expect(STOREFRONT_THEME_STORAGE_KEY).toBe('chopp.storefront.theme')
    expect(writeThemePreference(s, 'dark', STOREFRONT_THEME_STORAGE_KEY)).toBe(true)
    expect(readThemePreference(s, STOREFRONT_THEME_STORAGE_KEY)).toBe('dark')
    expect(readThemePreference(s)).toBeNull()
    expect([...s.data.keys()]).toEqual([STOREFRONT_THEME_STORAGE_KEY])
    writeThemePreference(s, 'light')
    expect(readThemePreference(s, STOREFRONT_THEME_STORAGE_KEY)).toBe('dark')
    expect(readThemePreference(s)).toBe('light')
  })
})
