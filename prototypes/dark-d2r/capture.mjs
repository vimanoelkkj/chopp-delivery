// Captura as três propostas contra o servidor local somente-leitura (npm run preview:admin:theme, porta 4321).
// O CSS de cada proposta é injetado em tempo de execução; nenhum arquivo da aplicação é alterado.
// Uso (da raiz do repositório): node prototypes/dark-d2r/capture.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'shots')
mkdirSync(out, { recursive: true })
const base = 'http://127.0.0.1:4321'
const ids = ['current', 'a', 'b', 'c']
const states = readFileSync(join(here, 'states.html'), 'utf8')
const themes = readFileSync(join(here, '../../src/styles/themes.css'), 'utf8')

const browser = await chromium.launch({ channel: 'chrome' })
const shots = []
for (const width of [1440, 390]) {
  for (const id of ids) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    const css = id === 'current' ? '' : readFileSync(join(here, `${id}.css`), 'utf8')
    const apply = async () => {
      if (css) await page.addStyleTag({ content: css })
      await page.evaluate((proto) => {
        if (proto !== 'current') document.querySelector('[data-admin]')?.setAttribute('data-dark-proto', proto)
        document.documentElement.style.background = getComputedStyle(
          document.querySelector('[data-admin]'),
        ).backgroundColor
      }, id)
      await page.evaluate(() => document.fonts.ready)
    }
    const snap = async (name, options = {}) => {
      const file = `${id}-${name}-${width}.png`
      await page.screenshot({ path: join(out, file), animations: 'disabled', ...options })
      shots.push({ id, name, width, file })
    }

    // 1. Catálogo
    await page.goto(`${base}/admin?adminTheme=dark`)
    await page.getByRole('heading', { level: 1, name: 'Produtos' }).waitFor()
    await apply()
    await snap('catalogo')

    // 2. Editor CMS (estado limpo e com alteração + campo inválido)
    await page.goto(`${base}/admin?adminTheme=dark#pagina-inicial`)
    const title = page.getByRole('textbox', { name: 'Título', exact: true })
    await title.waitFor()
    await apply()
    await title.fill('Rascunho privado · revisão local')
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).waitFor()
    await snap('editor')

    // 3. Modal de confirmação
    await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click()
    await page.getByRole('dialog', { name: 'Descartar as alterações?' }).waitFor()
    await snap('modal')
    await page.getByRole('button', { name: 'Continuar editando' }).click()

    // 4. Campo inválido (estado real do editor)
    await title.fill('x'.repeat(121))
    await title.focus()
    await snap('editor-invalido')

    // 5. Quadro de estados (botões, campos, avisos)
    await page.setContent(states)
    await page.addStyleTag({ content: themes })
    await apply()
    await snap('estados', { fullPage: true })
    await context.close()
  }
}
await browser.close()

const names = {
  current: 'Atual (D2, rejeitado)',
  a: 'A · Brasa Premium',
  b: 'B · Adega Noturna',
  c: 'C · Metal & Malte',
}
const sections = [
  ['catalogo', 'Catálogo de produtos'],
  ['editor', 'Editor CMS'],
  ['editor-invalido', 'Editor CMS — campo inválido com foco'],
  ['modal', 'Modal de confirmação'],
  ['estados', 'Botões, campos e avisos'],
]
let html = `<!doctype html><meta charset="utf-8"><title>D2R — comparativo</title>
<style>body{font:14px system-ui;background:#fff;color:#111;margin:24px}h2{margin:40px 0 8px}h3{margin:16px 0 4px}
.row{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}.row img{border:1px solid #ccc;max-width:100%;height:auto}
.d img{width:calc(25% - 10px)}.m img{width:calc(25% - 10px)}</style><h1>D2R — três direções de dark mode</h1>`
for (const width of [1440, 390]) {
  html += `<h2>${width}px</h2>`
  for (const [key, label] of sections) {
    html += `<h3>${label}</h3><div class="row ${width === 1440 ? 'd' : 'm'}">`
    for (const id of ids) {
      const s = shots.find((x) => x.id === id && x.name === key && x.width === width)
      html += `<figure style="margin:0"><figcaption>${names[id]}</figcaption><img src="shots/${s.file}" alt="${names[id]} ${label}"></figure>`
    }
    html += '</div>'
  }
}
writeFileSync(join(here, 'comparativo.html'), html)
console.log(`${shots.length} capturas em ${out}`)
