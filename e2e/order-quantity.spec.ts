import { expect, test } from '@playwright/test'

// Seletor de quantidade da tabela de preços: começa em 1, limite inferior, total e acessibilidade.
for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`quantidade na tabela de barris (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')

    const row = page.getByRole('row', { name: /Dronken/ })
    const group = row.getByRole('group', { name: /Quantidade de Dronken, barril de 30 litros/ })
    const minus = group.getByRole('button', {
      name: /Diminuir quantidade de Dronken, barril de 30/,
    })
    const plus = group.getByRole('button', { name: /Aumentar quantidade de Dronken, barril de 30/ })

    await expect(group.locator('output')).toContainText('1')
    await expect(minus).toBeDisabled()

    await plus.click()
    await plus.click()
    await expect(group.locator('output')).toContainText('3')
    await expect(minus).toBeEnabled()
    // 3 × R$ 510,00 (preço unitário vigente em landing.spec.ts).
    await expect(row.locator('output').filter({ hasText: 'Total' }).first()).toContainText('1.530')

    await minus.click()
    await minus.click()
    await expect(group.locator('output')).toContainText('1')
    await expect(minus).toBeDisabled()

    const box = await plus.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
  })
}

// Carrossel 3D no mobile: navegação, volume, quantidade e pedido em ordem, sem sobreposição.
test('carrossel 3D mobile: hierarquia sem sobreposição e alvos de 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const section = page.locator('#barris')
  const next = section.getByRole('button', { name: 'Próximo Barril' })
  const plus = section.getByRole('button', { name: /Aumentar quantidade de Dronken/ })
  const minus = section.getByRole('button', { name: /Diminuir quantidade de Dronken/ })
  const order = section
    .getByRole('link', { name: /Pedir Barril Dronken/ })
    .or(section.getByRole('button', { name: /Pedir Barril Dronken/ }))
  const volume = section.getByRole('button', { name: /Selecionar volume 50 Litros/ })
  await order.scrollIntoViewIfNeeded()

  const boxes = [
    await next.boundingBox(),
    await volume.boundingBox(),
    await minus.boundingBox(),
    await plus.boundingBox(),
    await order.boundingBox(),
  ]
  for (const box of boxes) expect(box).not.toBeNull()
  const [nextBox, , minusBox, plusBox, orderBox] = boxes as NonNullable<(typeof boxes)[number]>[]
  for (const box of [minusBox, plusBox]) {
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  // Ordem vertical: navegação, depois quantidade, depois pedido; nada se cruza.
  expect(minusBox.y).toBeGreaterThanOrEqual(nextBox.y + nextBox.height)
  expect(orderBox.y).toBeGreaterThanOrEqual(minusBox.y + minusBox.height)
  expect(orderBox.x).toBeGreaterThanOrEqual(0)
  expect(orderBox.x + orderBox.width).toBeLessThanOrEqual(390)

  // Troca de volume e de barril volta a quantidade para 1.
  await plus.click()
  await expect(section.locator('output').first()).toContainText('2')
  await volume.click()
  await expect(section.locator('output').first()).toContainText('1')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
})
