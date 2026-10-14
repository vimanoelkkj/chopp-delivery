import { chromium } from '@playwright/test'

const widths = [1440, 820, 412, 390, 360]
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('http://localhost:4173/')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.screenshot({ path: `shots/landing-${w}.png`, fullPage: true })
  console.log(w, 'height', h, 'overflowX', overflow, errors.length ? errors : '')
  await page.close()
}
await browser.close()
