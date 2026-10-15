import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

test.describe('Catálogo Expansível v2 - Isolamento e Produção Segura', () => {
  test('[Produção] URLs de preview do catálogo não expõem laboratório nem prévia v2 no build público', async ({
    page,
  }) => {
    const urls = ['/?preview=catalog', '/?preview=catalog#preview', '/#preview']

    for (const url of urls) {
      await page.goto(url)
      await page.waitForLoadState('domcontentloaded')

      // Em produção, a aplicação deve sempre renderizar a LandingPage regular
      await expect(page.locator('#topo')).toBeVisible()
      await expect(page.locator('#conteudo')).toBeVisible()

      // A vitrine é pública; laboratório e fixtures continuam exclusivos de DEV.
      await expect(page.locator('#catalogo-expansivel')).toHaveCount(0)
      await expect(page.locator('#chopes[data-testid="expandable-catalog-view"]')).toHaveCount(1)
      await expect(page.getByRole('button', { name: '4. Catálogo Expansível (v2)' })).toHaveCount(0)
      await expect(page.getByText('Prévia do Catálogo Público Expansível')).toHaveCount(0)
    }
  })

  test('[Produção] Zero vazamento de código ou fixtures v2 nos bundles compilados (dist/assets)', async () => {
    const distDir = path.resolve(process.cwd(), 'dist/assets')
    expect(fs.existsSync(distDir)).toBe(true)

    const files = fs.readdirSync(distDir)
    const jsAndCssFiles = files.filter((f) => f.endsWith('.js') || f.endsWith('.css'))

    for (const file of jsAndCssFiles) {
      const content = fs.readFileSync(path.join(distDir, file), 'utf-8')

      // Símbolos exclusivos do laboratório e da fixture DEV v2
      expect(content).not.toContain('FIXTURE_PUBLIC_CATALOG_V2')
      expect(content).not.toContain('EXPANDED_CATALOG_FIXTURE')
      expect(content).not.toContain('chope-imperial-stout-oculto')
      expect(content).not.toContain('cachaca-safra-antiga-oculta')
      expect(content).not.toContain('Delegas Session IPA (Demonstração)')
      expect(content).not.toContain('Cachaça Prata (Demonstração)')
    }
  })

  test('[Loja Pública] Tabela de chopes e identidade visual continuam 100% operacionais', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Seção de chopes original da loja funciona normalmente
    const chopesHeading = page.locator('#chopes-title')
    await expect(chopesHeading).toBeVisible()

    // Botão de WhatsApp/pedido e aviso 18+ presentes
    await expect(
      page
        .getByRole('button', { name: /pedir/i })
        .or(page.getByRole('link', { name: /pedir/i }))
        .first(),
    ).toBeVisible()
    await expect(
      page.getByText('Venda proibida para menores de 18 anos. Beba com moderação.').first(),
    ).toBeVisible()
  })
})
