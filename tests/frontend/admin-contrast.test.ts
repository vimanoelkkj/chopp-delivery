import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const tokens = read('src/styles/tokens.css') + read('src/features/admin/admin.css')
const token = (name: string) => {
  const match = new RegExp(`--${name}:\\s*#([0-9a-f]{3,6})\\b`, 'i').exec(tokens)
  if (!match) throw new Error(`token --${name} ausente`)
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

// Fundos onde o painel desenha texto: preto (campos, barra, login), fundo, painel de modal,
// linha da tabela e "steel" (skeleton/trilho).
const backgrounds = ['color-black', 'color-coal', 'color-panel', 'admin-row'].map(token)

it.each([
  ['vermelho de erro', token('admin-danger')],
  ['texto auxiliar (muted)', token('color-muted')],
  ['dourado', token('color-gold')],
])('%s tem contraste mínimo de 4,5:1 (WCAG AA, texto pequeno) em todos os fundos', (_, color) => {
  for (const background of backgrounds)
    expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5)
})

it('placeholder "não vende" tem 4,5:1 sobre o preto do campo', () => {
  const css = read('src/features/admin/catalog/PriceField.module.css')
  const placeholder = /::placeholder\s*{\s*color:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]
  expect(placeholder).toBeDefined()
  expect(contrast(placeholder as string, token('color-black'))).toBeGreaterThanOrEqual(4.5)
})

it('texto escuro sobre dourado e creme (botões e aviso de sucesso) passa em AAA', () => {
  for (const fill of [token('color-gold'), token('admin-gold-pending'), token('admin-cream')])
    expect(contrast(token('color-black'), fill)).toBeGreaterThanOrEqual(7)
})
