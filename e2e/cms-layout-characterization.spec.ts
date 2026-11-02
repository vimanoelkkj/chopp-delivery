import { expect, test } from '@playwright/test'
import type { PublicCatalog } from '../shared/catalog'

const composition = [
  'hero-title',
  'barris-title',
  'div',
  'chopes-title',
  'como-title',
  'sobre-title',
  'promo-title',
  'faq-title',
  'contato-title',
]
const navigation = ['#barris', '#chopes', '#como', '#faq']

for (const width of [390, 1440]) {
  test(`P0: approved public composition, landmarks and navigation at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.locator('tbody tr')).toHaveCount(8)
    const main = page.getByRole('main')
    await expect(main).toHaveAttribute('id', 'conteudo')
    await expect(page.getByRole('banner')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /O melhor do chopp\.\s*Direto para o seu evento\./,
    )
    const structure = await page.evaluate(() => ({
      composition: [...document.querySelector('#conteudo')!.children].map(
        (e) => e.getAttribute('aria-labelledby') ?? e.tagName.toLowerCase(),
      ),
      ids: [...document.querySelectorAll('[id]')].map((e) => e.id),
      anchors: [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].map((e) => ({
        href: e.getAttribute('href'),
        text: e.textContent?.trim(),
        label: e.getAttribute('aria-label'),
      })),
      sections: [...document.querySelectorAll('main > section')].map((e) => ({
        id: e.id,
        label: e.getAttribute('aria-labelledby'),
      })),
    }))
    expect(structure.composition).toEqual(composition)
    expect(new Set(structure.ids).size).toBe(structure.ids.length)
    expect(structure.ids).toEqual(
      expect.arrayContaining([
        'topo',
        'conteudo',
        'barris',
        'chopes',
        'como',
        'sobre',
        'faq',
        'contato',
      ]),
    )
    expect(structure.ids).not.toContain('inicio')
    for (const link of structure.anchors) expect(structure.ids).toContain(link.href!.slice(1))
    await testInfo.attach('public-structure', {
      body: JSON.stringify(structure, null, 2),
      contentType: 'application/json',
    })
    await testInfo.attach('public-landmarks', {
      body: await page.locator('body').ariaSnapshot(),
      contentType: 'text/plain',
    })
    const nav = page.getByRole('navigation', { name: 'Principal' })
    expect(
      await nav.locator('a').evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
    ).toEqual(navigation)
    const logo = page.getByRole('link', { name: 'Chopp Delivery Delegas, início' })
    await expect(logo).toHaveAttribute('href', '#topo')
    if (width === 390) {
      await page.getByRole('button', { name: 'Abrir menu' }).click()
      await expect(nav.getByRole('link', { name: 'Barris 3D' })).toBeVisible()
    }
    await nav.getByRole('link', { name: 'Barris 3D' }).click()
    await expect(page).toHaveURL(/#barris$/)
    await expect(page.locator('#barris')).toBeInViewport()
    if (width === 390)
      await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    await logo.click()
    await expect(page).toHaveURL(/#topo$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test(`P0: public catalog, fractional variants and WhatsApp remain coherent at ${width}px`, async ({
    page,
    request,
  }) => {
    const response = await request.get('/api/catalog')
    expect(response.status()).toBe(200)
    const before = (await response.json()) as PublicCatalog
    const data = structuredClone(before)
    const item = data.categories.find((c) => c.id === 'chopes')!.items[0]
    item.variants = [
      { code: '30', label: 'Barril 30', volumeMl: 30000, priceCents: 51000 },
      { code: '50', label: 'Barril 50', volumeMl: 50000, priceCents: 75000 },
      { code: 'fraction', label: 'Especial', volumeMl: 1500, priceCents: 1999 },
    ]
    await page.route('**/api/catalog', (route) => route.fulfill({ json: data }))
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const carousel = page.locator('#barris')
    const active = carousel.locator('article[aria-hidden="false"]')
    await expect(active).toContainText(item.name)
    await active.getByRole('button', { name: /1,5L/ }).click()
    await expect(active).toContainText('R$ 19,99')
    await expect(active.getByRole('button', { name: /30 Litros/ })).toContainText('510,00')
    await expect(active.getByRole('button', { name: /50 Litros/ })).toContainText('750,00')
    await expect(active.getByRole('button', { name: /1,5L/ })).toHaveClass(/priceSelected/)
    const order = carousel
      .getByRole('button', { name: /pedir|whatsapp/i })
      .or(carousel.getByRole('link', { name: /pedir|whatsapp/i }))
    await expect(order).toBeVisible()
    if (await order.getAttribute('href')) {
      const url = new URL((await order.getAttribute('href'))!)
      expect(url.hostname).toBe('wa.me')
      const message = url.searchParams.get('text')!
      expect(message).toContain(item.name)
      expect(message).toMatch(/1,5\s?L/)
      expect(message).toContain('19,99')
    } else {
      await order.click()
      await expect(
        carousel.getByRole('status').filter({ hasText: 'ainda não foi configurado' }),
      ).toBeVisible()
    }
    expect(await (await request.get('/api/catalog')).json()).toEqual(before)
  })
}
