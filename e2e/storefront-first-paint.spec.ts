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

/**
 * Regiões estáveis do fundo, em px CSS do quadro (viewport de 390 × 800):
 * as duas calhas laterais (8 px de cada borda) abaixo do cabeçalho (y ≥ 140) e acima da borda inferior.
 * O conteúdo do hero/painel começa a 16 px da borda (padding do container), então a calha só contém
 * a superfície do tema. Fora delas ficam texto, botão pêssego, fotos e o cabeçalho, que não dizem nada
 * sobre o tema do documento e distorciam a média do quadro inteiro (luma 77 no escuro aprovado).
 */
const REGIONS = [
  { name: 'calha esquerda', left: 0, top: 140, width: 8, height: 640 },
  { name: 'calha direita', left: 382, top: 140, width: 8, height: 640 },
] as const

const luma = (color: string) => {
  const [r, g, b] = color.split(',').map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Cor média (r,g,b) de cada região de fundo de um quadro PNG em base64. */
async function sampleRegions(data: string): Promise<string[]> {
  const image = sharp(Buffer.from(data, 'base64'))
  const { width = 390 } = await image.metadata()
  const scale = width / 390
  const colors: string[] = []
  for (const r of REGIONS) {
    const raw = await image
      .clone()
      .extract({
        left: Math.round(r.left * scale),
        top: Math.round(r.top * scale),
        width: Math.round(r.width * scale),
        height: Math.round(r.height * scale),
      })
      .resize(1, 1)
      .raw()
      .toBuffer()
    colors.push(`${raw[0]},${raw[1]},${raw[2]}`)
  }
  return colors
}

/**
 * Lista as violações do tema esperado em quadros já amostrados. Limites originais: escuro abaixo
 * de 70, claro acima de 190; nunca o preto padrão do <html>. Vazio quando tudo confere.
 */
function themeViolations(frames: string[][], expected: 'light' | 'dark'): string[] {
  const document = frames.slice(frames.findIndex((colors) => !colors.every((c) => BLANK.has(c))))
  if (frames.length === 0 || document.length === 0) return ['nenhum quadro de documento']
  const problems: string[] = []
  document.forEach((colors, index) => {
    colors.forEach((color, region) => {
      const value = luma(color)
      if (color === '0,0,0') problems.push(`quadro ${index} ${REGIONS[region].name}: preto padrão`)
      else if (expected === 'dark' && !(value < 70))
        problems.push(
          `quadro ${index} ${REGIONS[region].name}: ${color} (luma ${value.toFixed(1)}) não é escuro`,
        )
      else if (expected === 'light' && !(value > 190))
        problems.push(
          `quadro ${index} ${REGIONS[region].name}: ${color} (luma ${value.toFixed(1)}) não é claro`,
        )
    })
  })
  return problems
}

const FRAME = '/admin/preview/frame'

/**
 * O iframe real do painel só carrega com sessão: sem ela o servidor devolve uma página de erro
 * estática, sem theme-init.js, e a medição nunca chegaria ao documento da prévia. Para medir o
 * documento da prévia, responde a rota do frame com o mesmo index.html do SPA (como com sessão).
 */
async function serveFrameAsAuthenticated(page: Page) {
  await page.route(`**${FRAME}`, async (route) => {
    const spa = await route.fetch({ url: new URL('/', route.request().url()).href })
    await route.fulfill({ response: spa })
  })
}

async function capture(page: Page, path: string, { waitForTheme = true } = {}) {
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
  if (waitForTheme)
    await page.waitForFunction(
      () => document.querySelector('[data-theme-surface]') && document.fonts.status === 'loaded',
      null,
      { timeout: 30_000 },
    )
  else
    await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 30_000 })
  await page.waitForTimeout(1500)
  await cdp.send('Page.stopScreencast')
  const sampled: string[][] = []
  for (const data of frames) sampled.push(await sampleRegions(data))
  return sampled
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
      if (item.path === FRAME) await serveFrameAsAuthenticated(page)
      const frames = await capture(page, item.path)
      await context.close()
      expect(themeViolations(frames, item.expect)).toEqual([])
    })
  }
})

test.describe('o teste detecta tema incorreto na primeira pintura', () => {
  test('controle sintético: quadros claros e escuros são classificados nos dois sentidos', () => {
    const light = [['250,245,234', '250,245,234']]
    const dark = [['27,33,31', '27,33,31']]
    expect(themeViolations(dark, 'dark')).toEqual([])
    expect(themeViolations(light, 'light')).toEqual([])
    expect(themeViolations(light, 'dark')).not.toEqual([])
    expect(themeViolations(dark, 'light')).not.toEqual([])
    expect(themeViolations([['0,0,0', '0,0,0']], 'dark')).not.toEqual([])
    // Uma única calha errada em um único quadro já reprova.
    expect(
      themeViolations(
        [
          ['27,33,31', '27,33,31'],
          ['27,33,31', '250,245,234'],
        ],
        'dark',
      ),
    ).toHaveLength(1)
    // O limite de 70 não foi afrouxado: 77 (média antiga do hero) continua não sendo "escuro".
    expect(themeViolations([['77,78,68', '77,78,68']], 'dark')).not.toEqual([])
  })

  test('controle real: sem o script de primeira pintura, o escuro salvo pisca claro e é reprovado', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      colorScheme: 'light',
      viewport: { width: 390, height: 800 },
    })
    const page = await context.newPage()
    await page.addInitScript(() => localStorage.setItem(STORE, 'dark'))
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
    )
    // Defeito simulado: o theme-init.js não roda; o tema salvo só chega quando o React monta.
    await page.route('**/theme-init.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: '' }),
    )
    const frames = await capture(page, '/', { waitForTheme: false })
    await context.close()
    expect(themeViolations(frames, 'dark').length).toBeGreaterThan(0)
  })
})
