import { expect, type Locator, test } from '@playwright/test'

/**
 * Vitrine dinâmica: o catálogo é simulado na rede do navegador (dados descartáveis, sem backend).
 * Produtos 30/50 L ficam na tabela aprovada; as demais variantes entram numa lista complementar com
 * pedido próprio, sem volume em ml cru e sem repetir variante.
 */
const std = (id: string, name: string, p30: number, p50: number) => ({
  id,
  name,
  description: `Descrição ${name}`,
  visible: true,
  variants: [
    { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: p30 },
    { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: p50 },
  ],
})
const bottle = (id: string, name: string, priceCents: number) => ({
  id,
  name,
  description: `Cachaça ${name}`,
  visible: true,
  variants: [{ code: 'bottle', label: 'Garrafa', volumeMl: 700, priceCents }],
})
const mixed = std('mix', 'Misto', 40000, 60000)
;(mixed.variants as object[]).push({
  code: 'v_20',
  label: 'Barril de 20 L',
  volumeMl: 20000,
  priceCents: 30000,
})
const catalog = {
  revision: 'r1',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      items: [
        std('dronken', 'Dronken', 51000, 65000),
        mixed,
        {
          id: 'item_novo',
          name: 'Novo 20 e 40',
          description: 'Barris 20 e 40',
          visible: true,
          variants: [
            { code: 'v_20', label: 'Barril de 20 L', volumeMl: 20000, priceCents: 25000 },
            { code: 'v_40', label: 'Barril de 40 L', volumeMl: 40000, priceCents: 45000 },
          ],
        },
      ],
    },
    {
      id: 'cachacas',
      name: 'Cachaças',
      items: [bottle('c1', 'Cachaça Um', 9000), bottle('c2', 'Cachaça Dois', 12000)],
    },
  ],
}

for (const viewport of [
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'mobile 390', width: 390, height: 844 },
] as const) {
  test(`vitrine dinâmica em ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.route('**/api/catalog', (route) => route.fulfill({ json: catalog }))
    await page.goto('/')
    const section = page.locator('#chopes')
    await expect(section.locator('table')).toHaveCount(1)
    // Tabela aprovada: Dronken e Misto (30/50 L). O produto 100% novo não entra nela.
    await expect(section.locator('table tbody tr')).toHaveCount(2)
    await expect(section.getByText('Outras apresentações')).toHaveCount(1)
    await expect(section.getByRole('article', { name: 'Novo 20 e 40' })).toContainText(
      'Barril de 40 L',
    )
    await expect(section).not.toContainText(/\d{4,} ml/)

    // Pedidos: a tabela mantém os seus (Dronken e Misto, 30 e 50 L) e cada variante complementar
    // com preço ganha o próprio botão (Misto 20 L, Novo 20 L e 40 L). O texto da mensagem do
    // WhatsApp é coberto em dynamic-catalog.test.tsx (o e2e roda sem número configurado).
    // Sem número configurado o pedido é um botão; com número, um link: aceitamos os dois.
    const order = (scope: Locator, name?: RegExp) =>
      scope.locator('a, button').filter({ hasText: name ?? /^Pedir/ })
    await expect(order(section.locator('table'))).toHaveCount(4)
    const extras = section.getByRole('article')
    await expect(order(extras)).toHaveCount(3)
    await expect(order(extras, /^Pedir Misto, Barril de 20 L/)).toHaveCount(1)
    await expect(order(extras, /^Pedir Novo 20 e 40, Barril de 40 L/)).toHaveCount(1)
    await expect(section.getByText('R$ 450,00')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

/**
 * URL e mensagem finais do WhatsApp, com número de TESTE (nenhuma mensagem é enviada: só se lê o
 * href). Exige o número no build: `VITE_WHATSAPP_NUMBER=5511999990000 npx playwright test ...`.
 */
const TEST_NUMBER = process.env.VITE_WHATSAPP_NUMBER

test.describe('mensagem do WhatsApp na vitrine dinâmica', () => {
  test.skip(!TEST_NUMBER, 'defina VITE_WHATSAPP_NUMBER (número de teste) no build do E2E')

  test('produto novo de 20 L e variante adicional de produto existente, com quantidade > 1', async ({
    page,
  }) => {
    const existing = std('dronken', 'Dronken', 51000, 65000)
    ;(existing.variants as object[]).push({
      code: 'v_20',
      label: 'Barril de 20 L',
      volumeMl: 20000,
      priceCents: 30000,
    })
    const data = {
      revision: 'r1',
      categories: [
        {
          id: 'chopes',
          name: 'Chopes',
          items: [
            existing,
            {
              id: 'item_novo',
              name: 'Novo 20 L',
              description: 'Produto novo',
              visible: true,
              variants: [
                { code: 'v_20', label: 'Barril de 20 L', volumeMl: 20000, priceCents: 25000 },
              ],
            },
          ],
        },
        { id: 'cachacas', name: 'Cachaças', items: [bottle('c1', 'Cachaça Um', 9000)] },
      ],
    }
    await page.route('**/api/catalog', (route) => route.fulfill({ json: data }))
    await page.goto('/')
    const section = page.locator('#chopes')
    const message = async (name: RegExp) => {
      const href = await section.getByRole('link', { name }).first().getAttribute('href')
      const url = new URL(href as string)
      expect(`${url.origin}${url.pathname}`).toBe(`https://wa.me/${TEST_NUMBER}`)
      return (url.searchParams.get('text') ?? '').replaceAll(' ', ' ')
    }
    const more = async (subject: string, times: number) => {
      for (let i = 0; i < times; i++)
        await section.getByRole('button', { name: `Aumentar quantidade de ${subject}` }).click()
    }

    // Variante adicional (20 L) do produto que já existia: 3 unidades, preço da própria variante.
    await more('Dronken, Barril de 20 L', 2)
    const extra = await message(/^Pedir Dronken, Barril de 20 L/)
    expect(extra).toContain('barril de Dronken (Barril de 20 L)')
    expect(extra).toContain('Quantidade: 3 unidades.')
    expect(extra).toContain('Preço unitário: R$ 300.')
    expect(extra).toContain('Total: R$ 900.')

    // Produto novo de 20 L: 2 unidades, com o preço dele (não o do 20 L do Dronken).
    await more('Novo 20 L, Barril de 20 L', 1)
    const created = await message(/^Pedir Novo 20 L, Barril de 20 L/)
    expect(created).toContain('barril de Novo 20 L (Barril de 20 L)')
    expect(created).toContain('Quantidade: 2 unidades.')
    expect(created).toContain('Preço unitário: R$ 250.')
    expect(created).toContain('Total: R$ 500.')

    // As variantes 30/50 L da tabela seguem com os próprios preços e uma unidade.
    const d30 = await message(/^Pedir Dronken, barril de 30 litros/)
    const d50 = await message(/^Pedir Dronken, barril de 50 litros/)
    expect(d30).toContain('Dronken (30L)')
    expect(d30).toContain('Preço unitário: R$ 510.')
    expect(d50).toContain('Dronken (50L)')
    expect(d50).toContain('Preço unitário: R$ 650.')

    // Nenhuma variante vendável some ou repete: 4 pedidos distintos, com 4 preços distintos.
    const links = await section
      .locator('a[href*="wa.me"]')
      .evaluateAll((all) => all.map((a) => (a as HTMLAnchorElement).href))
    const dronkenAndNew = links
      .map((href) => new URL(href).searchParams.get('text') ?? '')
      .filter((text) => /Dronken|Novo 20 L/.test(text))
    expect(dronkenAndNew).toHaveLength(4)
    expect(new Set(dronkenAndNew).size).toBe(4)
  })
})
