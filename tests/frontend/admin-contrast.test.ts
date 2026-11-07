import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tokens do tema do painel. admin.css só aponta `--a-*` para `var(--theme-*)`; as cores vivem em
// src/styles/themes.css. O teste resolve essa cadeia para cada modo e protege os contrastes por
// papel: se alguém trocar uma cor do tema, a razão calculada abaixo precisa continuar acima do mínimo.
const admin = readFileSync('src/features/admin/admin.css', 'utf8')
const themes = readFileSync('src/styles/themes.css', 'utf8')

/** Variáveis `--x: valor;` do bloco cujo seletor é exatamente `selector`. */
function block(selector: string) {
  const start = themes.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`bloco ${selector} ausente em themes.css`)
  const body = themes.slice(themes.indexOf('{', start) + 1, themes.indexOf('}', start))
  return Object.fromEntries(
    [...body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  )
}

type Mode = 'claro' | 'escuro'
/** Paleta efetiva do painel: base clara; no escuro, o bloco escuro compartilhado e o do painel. */
const palette = (mode: Mode): Record<string, string> => {
  const light = block('[data-theme-surface]')
  if (mode === 'claro') return light
  return {
    ...light,
    ...block("[data-theme-surface][data-color-mode='dark']"),
    ...block("[data-theme-surface='admin'][data-color-mode='dark']"),
  }
}

const hex = (value: string, label: string) => {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (!match) throw new Error(`${label} não é uma cor hexadecimal: ${value}`)
  const digits = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1]
  return `#${digits}`
}

/** `--a-nome` → `var(--theme-x)` (admin.css) → valor hexadecimal (themes.css). */
const tokenIn = (mode: Mode) => (name: string) => {
  const alias = new RegExp(`--a-${name}:\\s*var\\((--theme-[a-z-]+)\\)`).exec(admin)
  if (!alias) throw new Error(`token --a-${name} ausente em admin.css`)
  const value = palette(mode)[alias[1]]
  if (!value) throw new Error(`${alias[1]} ausente em themes.css (${mode})`)
  return hex(value, alias[1])
}
const themeToken = (mode: Mode, name: string) => hex(palette(mode)[name] ?? '', name)

const channels = (color: string) =>
  [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255)
const luminance = (color: string) => {
  const [r, g, b] = channels(color).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// Superfícies onde o painel desenha texto.
const surfaces = ['bg', 'panel', 'input', 'sage', 'blue', 'changed']

for (const mode of ['claro', 'escuro'] as const) {
  describe(`contrastes do painel no tema ${mode}`, () => {
    const token = tokenIn(mode)

    it.each([
      ['texto', 'ink'],
      ['texto secundário', 'mute'],
      ['verde/acento (estado ativo)', 'green'],
    ])('%s tem 4,5:1 (WCAG AA) em todas as superfícies do painel', (_, name) => {
      for (const surface of surfaces)
        expect(contrast(token(name), token(surface))).toBeGreaterThanOrEqual(4.5)
    })

    it.each([
      ['erro', 'err', 'err-bg'],
      ['alerta', 'warn', 'warn-bg'],
      ['sucesso', 'ok', 'ok-bg'],
      ['informação', 'info', 'info-bg'],
      ['alerta sobre a linha alterada', 'warn', 'changed'],
      ['erro sobre o painel', 'err', 'panel'],
    ])('estado de %s tem 4,5:1 entre texto e fundo próprio', (_, text, background) => {
      expect(contrast(token(text), token(background))).toBeGreaterThanOrEqual(4.5)
    })

    it('rótulo da ação principal passa em normal, hover e pendente', () => {
      if (mode === 'claro') {
        // Grafite sobre o pêssego: AAA.
        for (const fill of ['peach', 'peach-hover', 'peach-active'])
          expect(contrast(token('ink'), token(fill))).toBeGreaterThanOrEqual(7)
      } else {
        // No escuro o texto da página é claro: o rótulo usa a tinta de ação (--theme-on-action).
        for (const fill of ['peach', 'peach-hover', 'peach-active'])
          expect(
            contrast(themeToken(mode, '--theme-on-action'), token(fill)),
          ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('placeholder ("não vende") usa a cor secundária e tem 4,5:1 sobre o campo', () => {
      const field = readFileSync('src/features/admin/catalog/PriceField.module.css', 'utf8')
      expect(/::placeholder\s*{\s*color:\s*var\(--a-mute\)/.test(field)).toBe(true)
      expect(contrast(token('mute'), token('input'))).toBeGreaterThanOrEqual(4.5)
    })

    it.each([
      ['borda de campo', 'field'],
      ['trilho do interruptor desligado', 'off'],
      ['trilho do interruptor ligado', 'green'],
    ])('%s tem 3:1 (WCAG 1.4.11) contra o fundo e o painel', (_, name) => {
      for (const surface of ['bg', 'panel'])
        expect(contrast(token(name), token(surface))).toBeGreaterThanOrEqual(3)
    })

    it('o anel de foco (cor do texto) tem 3:1 contra o fundo e o painel', () => {
      for (const surface of ['bg', 'panel'])
        expect(contrast(token('ink'), token(surface))).toBeGreaterThanOrEqual(3)
      // Sobre o pêssego/cobre da ação, só no claro o anel é a cor do texto escuro.
      if (mode === 'claro') expect(contrast(token('ink'), token('peach'))).toBeGreaterThanOrEqual(3)
    })
  })
}
