// Gera os CSS isolados dos três protótipos de dark mode (D2R) e o relatório de contraste.
// Uso: node prototypes/dark-d2r/build.mjs
// Nada aqui é importado pela aplicação: os CSS só são injetados pelo script de captura.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const rgba = (h, a) => `rgba(${hex(h).join(', ')}, ${a})`
const mix = (a, b, t) =>
  '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('')
const lum = (h) =>
  hex(h)
    .map((v) => {
      const n = v / 255
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
    })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

const palettes = {
  a: {
    name: 'A · Brasa Premium',
    background: '#141211', surface: '#1d1a17', input: '#110f0e', soft: '#27231f',
    feature: '#2d2620', raised: '#352e27',
    text: '#f5eee3', muted: '#b6aa9a', soft2: '#d6cbbb',
    border: '#3d3731', field: '#8f8272',
    accent: '#ebac62', action: '#dc8a4c', hover: '#e99c5f', active: '#c6743a', onAction: '#1a1109',
    changed: '#33291a',
    danger: '#ff9f90', dangerBg: '#3b201c', dangerBorder: '#94534b', dangerHover: '#4a2822',
    warning: '#f3c86f', warningBg: '#35290f',
    success: '#a3d3a8', successBg: '#202d22', successBorder: '#5f8a66',
    info: '#a3c8e8', infoBg: '#1e2a36', infoBorder: '#5b819f',
    thumb: '#141211',
  },
  b: {
    name: 'B · Adega Noturna',
    background: '#0f1115', surface: '#171a20', input: '#0c0e12', soft: '#20242c',
    feature: '#2a171c', raised: '#2b303a',
    text: '#efe9df', muted: '#a8aeb9', soft2: '#cfd3da',
    border: '#2f3540', field: '#7f8796',
    accent: '#dcc89f', action: '#8a2a3f', hover: '#9d3349', active: '#741f33', onAction: '#fbf1e2',
    changed: '#2c2318',
    danger: '#ff9aa6', dangerBg: '#3a1a22', dangerBorder: '#97505c', dangerHover: '#48212b',
    warning: '#f0cf8a', warningBg: '#312712',
    success: '#a8d2b4', successBg: '#1c2b24', successBorder: '#5f8b6d',
    info: '#a9c4e6', infoBg: '#1c2736', infoBorder: '#5f7fa4',
    thumb: '#0f1115',
  },
  c: {
    name: 'C · Metal & Malte',
    background: '#131719', surface: '#1b2124', input: '#0f1416', soft: '#252d2c',
    feature: '#2a3325', raised: '#313b38',
    text: '#eceee6', muted: '#a9b3aa', soft2: '#cfd6cb',
    border: '#36423c', field: '#80908a',
    accent: '#d9a74c', action: '#c9973b', hover: '#dca94d', active: '#b48530', onAction: '#16120a',
    changed: '#2f2a17',
    danger: '#ff9f8f', dangerBg: '#3a211d', dangerBorder: '#94554c', dangerHover: '#492a25',
    warning: '#f1cb74', warningBg: '#322a12',
    success: '#b4cf86', successBg: '#242e1e', successBorder: '#76904f',
    info: '#a6c7dc', infoBg: '#1e2a31', infoBorder: '#5f8296',
    thumb: '#131719',
  },
}

function css(id, p) {
  return `/* ${p.name} — protótipo isolado; só vale com data-dark-proto="${id}". */
[data-theme-surface='admin'][data-color-mode='dark'][data-dark-proto='${id}'] {
  --theme-background: ${p.background};
  --theme-surface: ${p.surface};
  --theme-input: ${p.input};
  --theme-surface-soft: ${p.soft};
  --theme-surface-feature: ${p.feature};
  --theme-surface-raised: ${p.raised};
  --theme-surface-neutral: ${p.soft};
  --theme-text: ${p.text};
  --theme-text-muted: ${p.muted};
  --theme-text-secondary: ${p.muted};
  --theme-text-soft: ${p.soft2};
  --theme-on-action: ${p.onAction};
  --theme-on-strong: #ffffff;
  --theme-border: ${p.border};
  --theme-border-warm: ${p.border};
  --theme-border-strong: ${p.field};
  --theme-field-border: ${p.field};
  --theme-accent: ${p.accent};
  --theme-disabled: ${mix(p.muted, p.surface, 0.62)};
  --theme-action: ${p.action};
  --theme-action-hover: ${p.hover};
  --theme-action-active: ${p.active};
  --theme-changed: ${p.changed};
  --theme-danger: ${p.danger};
  --theme-danger-bg: ${p.dangerBg};
  --theme-danger-border: ${p.dangerBorder};
  --theme-danger-hover: ${p.dangerHover};
  --theme-warning: ${p.warning};
  --theme-warning-bg: ${p.warningBg};
  --theme-success: ${p.success};
  --theme-success-bg: ${p.successBg};
  --theme-success-text: ${p.success};
  --theme-success-hover: ${p.success};
  --theme-success-border: ${p.successBorder};
  --theme-info: ${p.info};
  --theme-info-bg: ${p.infoBg};
  --theme-info-border: ${p.infoBorder};
  --theme-inset: ${rgba(p.soft, 0.7)};
  --theme-accent-line: ${rgba(p.accent, 0.3)};
  --theme-accent-border: ${rgba(p.accent, 0.45)};
  --theme-numeral: ${rgba(p.accent, 0.16)};
  --theme-header: ${rgba(p.background, 0.94)};
  --theme-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
  --theme-shadow-hover: 0 14px 30px rgba(0, 0, 0, 0.55);
  --theme-chip: ${p.raised};
  --theme-switch-thumb: ${p.thumb};
  --theme-overlay: rgb(0 0 0 / 0.72);
  --theme-save-shadow: 0 -0.5rem 1rem -0.75rem rgb(0 0 0 / 0.6);
  --theme-preview-canvas: ${p.background};
}
`
}

const lines = []
for (const [id, p] of Object.entries(palettes)) {
  writeFileSync(join(here, `${id}.css`), css(id, p))
  const pairs = [
    ['texto/fundo', p.text, p.background],
    ['texto/superfície', p.text, p.surface],
    ['suave/superfície', p.muted, p.surface],
    ['suave/fundo', p.muted, p.background],
    ['acento/superfície', p.accent, p.surface],
    ['botão (on-action/action)', p.onAction, p.action],
    ['botão hover', p.onAction, p.hover],
    ['botão active', p.onAction, p.active],
    ['borda campo/campo', p.field, p.input],
    ['borda campo/superfície', p.field, p.surface],
    ['erro/erro-bg', p.danger, p.dangerBg],
    ['aviso/aviso-bg', p.warning, p.warningBg],
    ['sucesso/sucesso-bg', p.success, p.successBg],
    ['info/info-bg', p.info, p.infoBg],
    ['texto/alterado', p.text, p.changed],
    ['texto/feature', p.text, p.feature],
  ]
  lines.push(`## ${p.name}`, '', '| Par | Razão |', '| --- | --- |')
  for (const [n, a, b] of pairs) lines.push(`| ${n} | ${ratio(a, b).toFixed(2)}:1 |`)
  lines.push('')
}
writeFileSync(join(here, 'contrast.md'), `# Contraste calculado (WCAG)\n\n${lines.join('\n')}`)
console.log(lines.join('\n'))
