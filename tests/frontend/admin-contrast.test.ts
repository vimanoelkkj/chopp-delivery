import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// Tokens do tema do painel (src/features/admin/admin.css). O teste protege os contrastes por papel:
// se alguém trocar uma cor do tema, a razão calculada abaixo precisa continuar acima do mínimo.
const css = readFileSync('src/features/admin/admin.css', 'utf8')
const token = (name: string) => {
  const match = new RegExp(`--a-${name}:\\s*#([0-9a-f]{3,6})\\b`, 'i').exec(css)
  if (!match) throw new Error(`token --a-${name} ausente`)
  const digits = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1]
  return `#${digits}`
}

const channels = (hex: string) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((v) =>
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

it.each([
  ['grafite (texto)', 'ink'],
  ['texto secundário', 'mute'],
  ['verde (estado ativo)', 'green'],
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

it('texto grafite sobre o pêssego da ação principal passa em AAA (normal, hover e pendente)', () => {
  for (const fill of ['peach', 'peach-hover', 'peach-active'])
    expect(contrast(token('ink'), token(fill))).toBeGreaterThanOrEqual(7)
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

it('o anel de foco (grafite) tem 3:1 contra o fundo, o painel e o pêssego', () => {
  for (const surface of ['bg', 'panel', 'peach'])
    expect(contrast(token('ink'), token(surface))).toBeGreaterThanOrEqual(3)
})
