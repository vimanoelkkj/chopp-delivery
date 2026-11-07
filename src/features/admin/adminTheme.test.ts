import { describe, expect, it } from 'vitest'
import { ADMIN_THEME_STORAGE_KEY } from '../../shared/lib/theme'
import { adminPreviewTheme, applyEarlyAdminTheme, initialAdminPreference } from './adminTheme'

describe('isolated dark admin preview', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'requires an explicit local opt-in (%s)',
    (hostname) => {
      expect(adminPreviewTheme(true, { hostname, search: '?adminTheme=dark' })).toBe('dark')
      expect(adminPreviewTheme(true, { hostname, search: '' })).toBe('light')
      expect(adminPreviewTheme(true, { hostname, search: '?adminTheme=system' })).toBe('light')
    },
  )
  it('never enables the preview in release or on a non-loopback host', () => {
    expect(adminPreviewTheme(false, { hostname: 'localhost', search: '?adminTheme=dark' })).toBe(
      'light',
    )
    expect(
      adminPreviewTheme(true, {
        hostname: 'chopp-delivery-homolog.pages.dev',
        search: '?adminTheme=dark',
      }),
    ).toBe('light')
  })
})

describe('initial admin preference', () => {
  const release = { hostname: 'chopp-delivery-homolog.pages.dev', search: '?adminTheme=dark' }
  const saved = (value: string | null) => ({
    getItem: (key: string) => (key === ADMIN_THEME_STORAGE_KEY ? value : null),
  })
  it('keeps light when nothing valid is saved', () => {
    expect(initialAdminPreference(false, release, saved(null))).toBe('light')
    expect(initialAdminPreference(false, release, saved('neon'))).toBe('light')
    expect(initialAdminPreference(false, release, null)).toBe('light')
  })
  it('uses the saved choice, even over the local DEV override', () => {
    for (const value of ['light', 'dark', 'system'] as const) {
      expect(initialAdminPreference(false, release, saved(value))).toBe(value)
      expect(
        initialAdminPreference(
          true,
          { hostname: 'localhost', search: '?adminTheme=dark' },
          saved(value),
        ),
      ).toBe(value)
    }
  })
  it('keeps the DEV loopback override when nothing is saved', () => {
    expect(
      initialAdminPreference(
        true,
        { hostname: 'localhost', search: '?adminTheme=dark' },
        saved(null),
      ),
    ).toBe('dark')
  })
})

describe('early admin theme marking', () => {
  const root = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement
  const at = (pathname: string) => ({ hostname: 'localhost', search: '', pathname })
  it('marks the admin routes', () => {
    for (const path of ['/admin', '/admin/', '/admin/preview']) {
      const html = root()
      applyEarlyAdminTheme(html, at(path), false)
      expect(html.dataset).toMatchObject({ theme: 'admin', themeSurface: 'admin' })
    }
  })
  it('leaves the public site and the CMS preview frame unmarked (the frame stays light)', () => {
    for (const path of ['/', '/admin/preview/frame', '/admin/preview/frame/']) {
      const html = root()
      applyEarlyAdminTheme(html, at(path), false)
      expect(html.dataset).toEqual({})
    }
  })
})
