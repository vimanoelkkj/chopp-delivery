import { expect, type Page, test } from '@playwright/test'
import sharp from 'sharp'

/**
 * D4C: primeira pintura real. Grava os quadros do navegador (CDP screencast) com CPU e rede
 * lentas contra o build de produção e exige que nenhum quadro do documento tenha a cor do tema
 * errado nem o preto padrão do <html>. Não basta olhar o DOM depois da montagem.
 */

const STORE = 'chopp.storefront.theme'
const ADMIN = 'chopp.admin.theme'
// Telas em branco do navegador antes do documento: ignoradas (branco; cinza escuro do canvas escuro).
const BLANK = new Set(['255,255,255', '18,18,18'])

type Case = {
  name: string
  path: string
  saved: Record<string, string>
  scheme: 'light' | 'dark'
  expect: 'light' | 'dark'
}

const CASES: Case[] = [
  {
    name: 'vitrine sem preferência (SO claro)',
    path: '/',
    saved: {},
    scheme: 'light',
    expect: 'light',
  },
  {
    name: 'vitrine sem preferência (SO escuro)',
    path: '/',
    saved: {},
    scheme: 'dark',
    expect: 'light',
  },
  {
    name: 'vitrine escuro salvo (SO claro)',
    path: '/',
    saved: { [STORE]: 'dark' },
    scheme: 'light',
    expect: 'dark',
  },
  {
    name: 'vitrine claro salvo (SO escuro)',
    path: '/',
    saved: { [STORE]: 'light' },
    scheme: 'dark',
    expect: 'light',
  },
  {
    name: 'vitrine sistema (SO escuro)',
    path: '/',
    saved: { [STORE]: 'system' },
    scheme: 'dark',
    expect: 'dark',
  },
  {
    name: 'vitrine sistema (SO claro)',
    path: '/',
    saved: { [STORE]: 'system' },
    scheme: 'light',
    expect: 'light',
  },
  {
    name: 'vitrine ignora a chave do painel',
    path: '/',
    saved: { [ADMIN]: 'dark' },
    scheme: 'light',
    expect: 'light',
  },
  {
    name: 'painel claro salvo',
    path: '/admin',
    saved: { [ADMIN]: 'light' },
    scheme: 'light',
    expect: 'light',
  },
  {
    name: 'painel escuro salvo',
    path: '/admin',
    saved: { [ADMIN]: 'dark' },
    scheme: 'light',
    expect: 'dark',
  },
  {
    name: 'painel ignora a chave da vitrine',
    path: '/admin',
    saved: { [STORE]: 'dark' },
    scheme: 'light',
    expect: 'light',
  },
  {
    name: 'prévia CMS (iframe) fica clara com painel e vitrine escuros',
    path: '/admin/preview/frame',
    saved: { [ADMIN]: 'dark', [STORE]: 'dark' },
    scheme: 'dark',
    expect: 'light',
  },
]

async function capture(page: Page, path: string) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: 200_000,
    uploadThroughput: 100_000,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const frames: string[] = []
  cdp.on('Page.screencastFrame', (frame) => {
    frames.push(frame.data)
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  await page.goto(path, { waitUntil: 'commit' })
  await page.waitForFunction(
    () => document.querySelector('[data-theme-surface]') && document.fonts.status === 'loaded',
    null,
    { timeout: 30_000 },
  )
  await page.waitForTimeout(1500)
  await cdp.send('Page.stopScreencast')
  const colors: string[] = []
  for (const data of frames) {
    const raw = await sharp(Buffer.from(data, 'base64')).resize(1, 1).raw().toBuffer()
    colors.push(`${raw[0]},${raw[1]},${raw[2]}`)
  }
  return colors
}

const luma = (color: string) => {
  const [r, g, b] = color.split(',').map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

test.describe('primeira pintura real (390 px, CPU 4x e rede lenta)', () => {
  test.use({ viewport: { width: 390, height: 800 } })
  for (const item of CASES) {
    test(item.name, async ({ browser }) => {
      const context = await browser.newContext({
        colorScheme: item.scheme,
        viewport: { width: 390, height: 800 },
      })
      const page = await context.newPage()
      await page.addInitScript((saved) => {
        for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value)
      }, item.saved)
      await page.route('**/api/auth/me', (route) =>
        route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
      )
      const colors = await capture(page, item.path)
      await context.close()
      const document = colors.slice(colors.findIndex((color) => !BLANK.has(color)))
      expect(document.length).toBeGreaterThan(0)
      // Nunca o preto padrão do <html>, nem o tema oposto, em nenhum quadro do documento.
      expect(document).not.toContain('0,0,0')
      for (const color of document)
        if (item.expect === 'dark') expect(luma(color), color).toBeLessThan(70)
        else expect(luma(color), color).toBeGreaterThan(190)
    })
  }
})
