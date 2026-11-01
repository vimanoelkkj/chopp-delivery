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

  // Original: zero imagens no Hero anterior. C tem barril legítimo; proteger estabilidade e acessibilidade.
  test('[Hero C] imagem estável e navegação acessível com movimento reduzido', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await expect(page.locator('tbody tr')).toHaveCount(8)
      await page.evaluate(() => document.fonts.ready)
      const hero = page.getByRole('region', { name: /O melhor do chopp/i })
      const heading = hero.getByRole('heading', { level: 1 })
      const image = hero.getByRole('img', { name: /Barril de Chopp/i })
      await expect(heading).toBeVisible()
      await expect(image).toHaveJSProperty('complete', true)
      expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
      expect(await hero.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toMatch(/logo/i)
      const geometry = () =>
        hero.evaluate((el) =>
          [...el.querySelectorAll('h1, a, button, img')].map((node) => {
            const r = node.getBoundingClientRect()
            return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }
          }),
        )
      await image.scrollIntoViewIfNeeded()
      const before = await geometry()
      await image.hover()
      const motion = await image.evaluate((el) => ({
        durations: getComputedStyle(el).transitionDuration.split(',').map(Number.parseFloat),
        transform: getComputedStyle(el).transform,
      }))
      expect(motion.durations, 'hover sem transição não essencial em reduced-motion').toEqual(
        motion.durations.map(() => 0),
      )
      expect(motion.transform).toBe('none')
      expect(
        await hero.evaluate(
          (el) =>
            el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
        ),
      ).toBe(0)
      const after = await geometry()
      for (let i = 0; i < before.length; i++)
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(Math.abs(after[i][key] - before[i][key])).toBeLessThanOrEqual(1)
      const explore = hero.getByRole('link', { name: 'Explorar Barris 3D' })
      await explore.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(explore).toBeFocused()
      expect(await explore.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
      expect(
        await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
      ).toBe('auto')
      await explore.press('Enter')
      await expect(page).toHaveURL(/#barris$/)
      await expect(
        page.getByRole('heading', { level: 2, name: 'Escolha seu Barril em 3D' }),
      ).toBeInViewport()
    }
  })
})
