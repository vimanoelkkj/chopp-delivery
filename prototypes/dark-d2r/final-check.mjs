// Verificação final da Brasa Premium contra o servidor de prévia local (porta 4321).
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
const out = join(dirname(fileURLToPath(import.meta.url)), 'final')
const base = 'http://127.0.0.1:4321'
const lum = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return ((x + 0.05) / (y + 0.05)).toFixed(2) }
const browser = await chromium.launch({ channel: 'chrome' })
const report = []
for (const width of [390, 1440]) for (const mode of ['light', 'dark']) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })).newPage()
  const key = `${mode}-${width}`
  await page.goto(`${base}/admin?adminTheme=${mode}`)
  await page.getByRole('heading', { level: 1, name: 'Produtos' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  const info = await page.evaluate(() => { const els = [...document.querySelectorAll('[class*=hint],[class*=info],[class*=note]')]; const e = els[0]; if (!e) return null; const s = getComputedStyle(e); return { color: s.color, bg: s.backgroundColor } })
  const disabled = await page.evaluate(() => { const b = [...document.querySelectorAll('button:disabled')].find((x) => x.textContent.includes('Salvar')); if (!b) return null; const s = getComputedStyle(b); return { opacity: s.opacity, color: s.color, bg: s.backgroundColor } })
  const active = await page.evaluate(() => { const b = document.querySelector('button:not(:disabled)[class*=gold]'); if (!b) return null; const s = getComputedStyle(b); return { color: s.color, bg: s.backgroundColor } })
  await page.screenshot({ path: join(out, `${key}-catalogo.png`), animations: 'disabled' })
  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
  let o = await overflow()
  await page.goto(`${base}/admin?adminTheme=${mode}#pagina-inicial`)
  const title = page.getByRole('textbox', { name: 'Título', exact: true })
  await title.waitFor(); await title.fill('Rascunho privado · revisão local')
  await page.screenshot({ path: join(out, `${key}-editor.png`), animations: 'disabled' })
  o ||= await overflow()
  await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.screenshot({ path: join(out, `${key}-modal.png`), animations: 'disabled' })
  await page.getByRole('button', { name: 'Continuar editando' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await title.fill('x'.repeat(121)); await title.focus()
  await title.waitFor(); await page.waitForTimeout(300)
  const err = await page.evaluate(() => { const e = document.querySelector('input[aria-invalid=true],textarea[aria-invalid=true]'); const s = getComputedStyle(e); return { color: s.color, bg: s.backgroundColor, border: s.borderColor, outline: s.outlineColor } })
  await page.screenshot({ path: join(out, `${key}-erro-foco.png`), animations: 'disabled' })
  o ||= await overflow()
  report.push({ key, overflow: o, disabled, active, info, err, errContrast: ratio(err.color, err.bg), focusRing: ratio(err.outline, err.bg), disabledVsActiveBg: disabled && active ? [disabled.bg, active.bg] : null })
}
await browser.close()
console.log(JSON.stringify(report, null, 1))
