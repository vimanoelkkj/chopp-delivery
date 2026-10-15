import { expect, type Page, test } from '@playwright/test'
import { standardCatalog } from '../e2e/support/catalog'

/**
 * StrictMode só executa em DEV. A prova de "uma leitura por carga" só vale se o app estiver
 * REALMENTE envolvido por <StrictMode> em tempo de execução. Procurar a palavra no código-fonte
 * não prova isso: o import pode ficar e o wrapper sumir. Aqui se lê a árvore de fibers do React.
 *
 * Fiber.mode: StrictLegacyMode = 0b01000 (8) e StrictEffectsMode = 0b10000 (16). Um <StrictMode>
 * marca esses bits no próprio fiber e em todos os descendentes (o fiber raiz fica de fora).
 */
const STRICT_BITS = 8 | 16

async function fiberModes(page: Page): Promise<number[] | null> {
  return page.evaluate(() => {
    const root = document.getElementById('root') as unknown as Record<string, unknown> | null
    const key = root && Object.keys(root).find((name) => name.startsWith('__reactContainer$'))
    if (!root || !key) return null
    const modes: number[] = []
    let fiber = root[key] as { mode: number; child: unknown } | null
    while (fiber && modes.length < 8) {
      modes.push(fiber.mode)
      fiber = fiber.child as typeof fiber
    }
    return modes
  })
}

/** O primeiro descendente do fiber raiz (o elemento passado a `render`) e todo o resto. */
async function strictModeIsActive(page: Page): Promise<boolean> {
  const modes = await fiberModes(page)
  if (!modes || modes.length < 3) throw new Error('árvore de fibers do React não encontrada')
  return modes.slice(1).every((mode) => (mode & STRICT_BITS) === STRICT_BITS)
}

async function serveCatalog(page: Page) {
  const counter = { requests: 0, fail: false }
  await page.route('**/api/catalog', async (route) => {
    counter.requests++
    if (counter.fail)
      await route.fulfill({ status: 503, json: { error: { code: 'CATALOG_UNAVAILABLE' } } })
    else await route.fulfill({ json: standardCatalog() })
  })
  return counter
}

test('StrictMode em DEV: uma leitura de /api/catalog por carga, e uma por tentativa', async ({
  page,
}) => {
  const catalog = await serveCatalog(page)
  await page.goto('/')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  // A garantia só significa algo se o app estiver, de fato, dentro do <StrictMode>.
  expect(await strictModeIsActive(page)).toBe(true)
  await page.waitForTimeout(500) // dá tempo a qualquer leitura extra atrasada
  expect(catalog.requests).toBe(1)

  catalog.fail = true
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Catálogo indisponível')
  await page.waitForTimeout(500)
  expect(catalog.requests).toBe(2)

  catalog.fail = false
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.waitForTimeout(300)
  expect(catalog.requests).toBe(3)
})

test('o detector enxerga o wrapper em execução (fibers com os bits de StrictMode)', async ({
  page,
}) => {
  await serveCatalog(page)
  await page.goto('/')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  const modes = await fiberModes(page)
  expect(modes?.[0]).toBeDefined()
  expect(modes?.slice(1).every((mode) => (mode & STRICT_BITS) === STRICT_BITS)).toBe(true)
  expect(await strictModeIsActive(page)).toBe(true)
})

test('teste negativo: sem o wrapper efetivo o detector acusa, mesmo com o import e a palavra no código', async ({
  page,
}) => {
  // Reescreve o módulo servido: o `import { StrictMode }` e o identificador continuam lá, mas o
  // elemento passa a ser um Fragment. Uma busca textual por "StrictMode" ainda passaria.
  let served = ''
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch()
    const original = await response.text()
    served = original.replace(
      '_jsxDEV(StrictMode,',
      '_jsxDEV(__vite__cjsImport9_react["Fragment"],',
    )
    await route.fulfill({ response, body: served })
  })
  await serveCatalog(page)
  await page.goto('/')
  await expect(page.locator('tbody tr')).toHaveCount(2)

  expect(served).toContain('const StrictMode =') // o import/identificador permanecem
  expect(served).not.toContain('_jsxDEV(StrictMode,') // mas o wrapper foi removido
  expect(served).toMatch(/StrictMode/) // a busca textual do teste antigo ainda "passaria"
  expect(await strictModeIsActive(page)).toBe(false)
})
