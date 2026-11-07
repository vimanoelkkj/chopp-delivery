import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_THEME_STORAGE_KEY,
  parseThemePreference,
  resolveThemeMode,
  STOREFRONT_THEME_STORAGE_KEY,
  systemMode,
} from './theme'

const SCRIPT = readFileSync('public/theme-init.js', 'utf8')

type World = {
  path: string
  saved?: Record<string, string>
  systemDark?: boolean
  storage?: 'ok' | 'blocked'
  matchMedia?: 'ok' | 'missing'
}

/** Executa o script real de primeira pintura contra um <html> falso e devolve o que ele marcou. */
function run({ path, saved = {}, systemDark = false, storage = 'ok', matchMedia = 'ok' }: World) {
  const dataset: Record<string, string> = {}
  const window = {
    location: { pathname: path },
    get localStorage() {
      if (storage === 'blocked') throw new DOMException('blocked', 'SecurityError')
      return { getItem: (key: string) => saved[key] ?? null }
    },
    matchMedia: matchMedia === 'missing' ? undefined : () => ({ matches: systemDark }),
  }
  runInNewContext(SCRIPT, { window, document: { documentElement: { dataset } } })
  return dataset
}

const expectedMode = (key: string, saved: Record<string, string>, systemDark: boolean) =>
  resolveThemeMode(parseThemePreference(saved[key]) ?? 'light', systemMode(systemDark))

describe('theme-init.js (primeira pintura)', () => {
  it('vitrine: claro por padrão e chave própria', () => {
    expect(run({ path: '/' })).toEqual({
      theme: 'pastel',
      themeSurface: 'storefront',
      colorMode: 'light',
    })
    expect(STOREFRONT_THEME_STORAGE_KEY).toBe('chopp.storefront.theme')
  })

  it.each(['light', 'dark', 'system', 'sepia', '', '<script>'])(
    'vitrine: valor salvo %j resolve como os helpers do React',
    (value) => {
      for (const systemDark of [false, true]) {
        const saved = { [STOREFRONT_THEME_STORAGE_KEY]: value }
        expect(run({ path: '/', saved, systemDark }).colorMode).toBe(
          expectedMode(STOREFRONT_THEME_STORAGE_KEY, saved, systemDark),
        )
      }
    },
  )

  it('painel: usa só a chave do painel e a vitrine só a dela', () => {
    const saved = { [ADMIN_THEME_STORAGE_KEY]: 'dark', [STOREFRONT_THEME_STORAGE_KEY]: 'light' }
    expect(run({ path: '/admin', saved })).toEqual({
      theme: 'admin',
      themeSurface: 'admin',
      colorMode: 'dark',
    })
    expect(run({ path: '/', saved }).colorMode).toBe('light')
    expect(
      run({ path: '/admin', saved: { [STOREFRONT_THEME_STORAGE_KEY]: 'dark' } }).colorMode,
    ).toBe('light')
    expect(run({ path: '/', saved: { [ADMIN_THEME_STORAGE_KEY]: 'dark' } }).colorMode).toBe('light')
  })

  it('painel: /admin/ e /admin/preview seguem o painel', () => {
    const saved = { [ADMIN_THEME_STORAGE_KEY]: 'dark' }
    for (const path of ['/admin', '/admin/', '/admin/preview', '/admin/preview/'])
      expect(run({ path, saved })).toMatchObject({ themeSurface: 'admin', colorMode: 'dark' })
  })

  it('prévia CMS: sempre vitrine clara, ignora qualquer preferência e o sistema', () => {
    const saved = { [ADMIN_THEME_STORAGE_KEY]: 'dark', [STOREFRONT_THEME_STORAGE_KEY]: 'dark' }
    for (const path of ['/admin/preview/frame', '/admin/preview/frame/'])
      expect(run({ path, saved, systemDark: true })).toEqual({
        theme: 'pastel',
        themeSurface: 'storefront',
        colorMode: 'light',
      })
  })

  it('protótipos de desenvolvimento não são marcados', () => {
    expect(run({ path: '/__proto/a', saved: { [STOREFRONT_THEME_STORAGE_KEY]: 'dark' } })).toEqual(
      {},
    )
  })

  it('armazenamento bloqueado ou sem matchMedia mantém o claro e não lança', () => {
    expect(run({ path: '/', storage: 'blocked' }).colorMode).toBe('light')
    expect(run({ path: '/admin', storage: 'blocked' }).colorMode).toBe('light')
    const saved = { [STOREFRONT_THEME_STORAGE_KEY]: 'system' }
    expect(run({ path: '/', saved, matchMedia: 'missing' }).colorMode).toBe('light')
  })

  it('não usa eval nem escreve no documento além dos três atributos', () => {
    expect(SCRIPT).not.toMatch(/\beval\b|new Function|document\.write|innerHTML/)
  })
})
