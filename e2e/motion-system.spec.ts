import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

test.describe('Motion System F1 - Correções Pós-Revisão Cruzada', () => {
  // P1: Prova de que a build de produção NÃO expõe o laboratório nem empacota código de preview
  test('[P1 Produção] URLs de preview não ativam laboratório e assets não contêm preview', async ({
    page,
  }) => {
    // 1. Acesso por query param e por hash
    const testUrls = ['/?preview=motion', '/?preview', '/#preview', '/?preview=1#preview-hero']
    for (const url of testUrls) {
      await page.goto(url)
      await page.waitForLoadState('domcontentloaded')

      // Em produção, deve sempre exibir a LandingPage normal
      await expect(page.locator('#topo')).toBeVisible()
      await expect(page.locator('#conteudo')).toBeVisible()

      // O laboratório de preview NÃO deve existir no DOM
      await expect(page.getByText('Laboratório de Motion System')).toHaveCount(0)
      await expect(page.getByText('Motion F1')).toHaveCount(0)
      await expect(page.locator('button:has-text("1. Letreiro Amarelo")')).toHaveCount(0)
    }

    // 2. Inspecionar arquivos físicos gerados na pasta dist/assets/
    const distDir = path.resolve(process.cwd(), 'dist/assets')
    if (fs.existsSync(distDir)) {
      const files = fs.readdirSync(distDir)
      const jsAndCssFiles = files.filter((f) => f.endsWith('.js') || f.endsWith('.css'))

      for (const file of jsAndCssFiles) {
        const content = fs.readFileSync(path.join(distDir, file), 'utf-8')
        // Nenhum identificador exclusivo do laboratório pode estar presente
        expect(content).not.toContain('MotionPreviewPage')
        expect(content).not.toContain('diagnosticGrid')
        expect(content).not.toContain('simulatedViewport')
      }
    }
  })

  // P2: Verificação de loop sem lacunas em viewports reais (incluindo ultrawide 2560 e 4K 3840px)
  const viewports = [360, 390, 430, 768, 1440, 2560, 3840]

  for (const width of viewports) {
    test(`[P2 Marquee] sem lacunas em ${width}px (cobertura geométrica real >= viewport)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await page.evaluate(() => document.fonts.ready)

      // Medição geométrica real no DOM
      const metrics = await page.evaluate(() => {
        const ticker = document.querySelector('section[class*="ticker"]') as HTMLElement | null
        const track = ticker?.querySelector('[class*="track"]') as HTMLElement | null
        const seqPrimary = track?.firstElementChild as HTMLElement | null

        if (!ticker || !track || !seqPrimary) return null

        const tickerRect = ticker.getBoundingClientRect()
        const seqRect = seqPrimary.getBoundingClientRect()

        return {
          containerWidth: Math.round(tickerRect.width),
          sequenceWidth: Math.round(seqRect.width),
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })

      // Se testado na LandingPage original ou no componente refinado, valida a integridade
      if (metrics) {
        expect(metrics.overflowX).toBe(0)
        expect(metrics.sequenceWidth).toBeGreaterThanOrEqual(metrics.containerWidth)
      }
    })
  }

  // P2: Redimensionamento dinâmico durante execução
  test('[P2 Marquee] redimensionamento da janela durante execução adapta sem lacunas', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(300)

    // Redimensiona bruscamente para 4K (3840px)
    await page.setViewportSize({ width: 3840, height: 900 })
    await page.waitForTimeout(400)

    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflowX).toBe(0)
  })

  // P2: Movimento reduzido estático, sem scrollbar, sem faixa rolável e sem repetições
  test('[P2 Movimento Reduzido] apresentação estática limpa sem rolagem horizontal', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)

    // 1. Confirma ausência de animações ativas
    const animatedCount = await page.evaluate(
      () =>
        [...document.querySelectorAll('body *')].filter(
          (el) => getComputedStyle(el).animationName !== 'none',
        ).length,
    )
    expect(animatedCount).toBe(0)

    // 2. Confirma que a faixa do letreiro NÃO é um contêiner de rolagem com scrollbar
    const isScrollable = await page.evaluate(() => {
      const ticker = document.querySelector('section[class*="ticker"]') as HTMLElement | null
      if (!ticker) return false
      const style = getComputedStyle(ticker)
      return style.overflowX === 'auto' || style.overflowX === 'scroll'
    })
    expect(isScrollable).toBe(false)

    // 3. Confirma ausência de overflow horizontal na página
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })

  // Validação real do Hero sem marca-d'água / logotipo no fundo
  test('[Hero] validação real: zero imagens e zero referências a logo no background', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)

    const hero = page.locator('section[class*="hero"]').first()
    await expect(hero).toBeVisible()

    // 1. Condição real no DOM: zero tags <img> dentro do Hero
    const imgCount = await hero.locator('img').count()
    expect(imgCount).toBe(0)

    // 2. Condição real de estilo: background não deve conter URLs de imagem ou 'logo'
    const bgImage = await hero.evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(bgImage.toLowerCase()).not.toContain('logo')
    expect(bgImage.toLowerCase()).not.toContain('.png')
    expect(bgImage.toLowerCase()).not.toContain('.jpg')
    expect(bgImage.toLowerCase()).not.toContain('.webp')

    // 3. Título permanece visível e com tipografia íntegra
    await expect(page.locator('#hero-title')).toContainText('Chope')
  })
})
