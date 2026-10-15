import { fork } from 'node:child_process'
import { once } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { childEnv, SENSITIVE_NAME } from '../../scripts/clean-env.mts'
import { integrationPort } from '../../scripts/integration-port.mts'

type Ready = {
  origin: string
  username: string
  password: string
  directory: string
  envKeys?: string[]
  error?: string
}
type Integration = Ready & { database: DatabaseSync }
const test = base.extend<{
  integration: Integration
  runtimeMode: 'admin-integration' | 'production'
  whatsappNumber: string
}>({
  runtimeMode: ['admin-integration', { option: true }],
  whatsappNumber: ['', { option: true }],
  integration: [
    async ({ browserName, runtimeMode, whatsappNumber }, use) => {
      if (browserName !== 'chromium') throw new Error('This suite targets local Chrome/Chromium')
      const child = fork('tests/e2e-real/server.mts', [], {
        execArgv: [],
        // Allowlist: o servidor descartável não recebe as credenciais do operador.
        env: childEnv({
          // Explícita e validada: a allowlist não a repassa sozinha, e o servidor precisa ouvir na
          // MESMA porta do baseURL do navegador (playwright.real.config.ts).
          DELEGAS_INTEGRATION_PORT: String(integrationPort()),
          DELEGAS_INTEGRATION_MODE: runtimeMode,
          VITE_WHATSAPP_NUMBER: whatsappNumber,
        }),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
      })
      child.stdout?.pipe(process.stdout)
      child.stderr?.pipe(process.stderr)
      let database: DatabaseSync | undefined
      const exited = once(child, 'exit')
      try {
        const ready = await Promise.race([
          once(child, 'message').then(([message]) => message as Ready),
          exited.then(() => {
            throw new Error('Disposable server exited before ready')
          }),
        ])
        if (ready.error) throw new Error(ready.error)
        // Falha rápida e clara se runner e servidor divergirem de porta.
        if (new URL(ready.origin).port !== String(integrationPort()))
          throw new Error(`Porta divergente: servidor ${ready.origin}, runner ${integrationPort()}`)
        await readFile(join(ready.directory, '.owner'), 'utf8')
        const files = await readdir(join(ready.directory, 'state', 'v3', 'd1'), { recursive: true })
        const sqlite = files.filter((name) => /(?:^|[\\/])[a-f0-9]{64}\.sqlite$/.test(name))
        expect(sqlite).toHaveLength(1)
        database = new DatabaseSync(join(ready.directory, 'state', 'v3', 'd1', sqlite[0]))
        database.exec('PRAGMA busy_timeout=5000')
        await use({ ...ready, database })
      } finally {
        database?.close()
        if (child.connected) child.send('close')
        await exited
      }
    },
    { auto: true, timeout: 120_000 },
  ],
})
function row<T>(instance: Integration, sql: string, ...values: (string | number | null)[]): T {
  return instance.database.prepare(sql).get(...values) as T
}
const path = '/api/admin/catalog/v2'
const save = (page: Page) => page.getByRole('button', { name: /^Salvar/ })
const price = (page: Page) => page.getByLabel('30 L, preço em reais, Dronken', { exact: true })
async function login(page: Page, instance: Integration) {
  await page.goto('/admin?mock=error') // The real mode must ignore mock switches.
  await page.getByLabel('Usuário').fill(instance.username)
  await page.getByLabel('Senha', { exact: true }).fill(instance.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dronken', exact: true })).toBeVisible()
}
async function add(
  page: Page,
  category: 'Chopes' | 'Cachaças',
  name: string,
  volume: string,
  cents: string,
) {
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Novo produto' })
  await dialog.getByRole('radio', { name: category }).check()
  await dialog.getByRole('button', { name: 'Adicionar ao rascunho' }).click()
  await expect(dialog).toBeHidden()
  const item = page.getByRole('listitem').filter({ hasText: 'Novo · não salvo' }).last()
  await item.getByLabel('Nome', { exact: true }).fill(name)
  await item.getByLabel('Rótulo', { exact: true }).first().fill(`Volume ${volume}`)
  await item
    .getByLabel(/^Volume \(/)
    .first()
    .fill(volume)
  await item
    .getByLabel(/^Preço em reais/)
    .first()
    .fill(cents)
  return item
}
async function saved(page: Page) {
  await save(page).click()
  await expect(page.getByText('Tudo salvo.', { exact: true })).toBeVisible()
}
async function dbPrice(instance: Integration) {
  return row<{ price_cents: number }>(
    instance,
    'SELECT price_cents FROM catalog_variants WHERE item_id=? AND code=?',
    'dronken',
    '30',
  ).price_cents
}
async function catalogState(instance: Integration) {
  return ['catalog_items', 'catalog_variants', 'catalog_meta'].map((t) =>
    instance.database.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
  )
}

test('A/B/M/N: actual F2 cookie, panel PUT, decimal cents and reload persistence', async ({
  page,
  context,
  integration,
}) => {
  await login(page, integration)
  const cookie = (await context.cookies()).find((c) => c.name === 'delegas_admin_local_session')
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe('Strict')
  expect(await page.evaluate(() => document.cookie)).not.toContain('delegas_admin_local_session')
  await price(page).fill('51029')
  const response = page.waitForResponse(
    (r) => r.url().endsWith(path) && r.request().method() === 'PUT',
  )
  await saved(page)
  const r = await response
  expect(r.status()).toBe(200)
  const payload = r.request().postDataJSON()
  expect(r.request().headers()['if-match']).toBe(JSON.stringify(payload.revision))
  expect(payload.categories[0]).toHaveProperty('name', 'Chopes')
  expect(await dbPrice(integration)).toBe(51029)
  await page.reload()
  await expect(price(page)).toHaveValue('510,29')
})

test('C/D/E/L: real creations, definitive identities, null size and public visibility', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  let item = await add(page, 'Chopes', 'Chope Chrome', '20', '12345')
  await item.getByRole('button', { name: 'Adicionar variante' }).click()
  await item.getByLabel('Rótulo', { exact: true }).last().fill('Barril 7,5 L')
  await item.getByLabel('Volume (L)', { exact: true }).last().fill('7,5')
  await item.getByRole('switch').check()
  await saved(page)
  const persisted = row<{ id: string; creation_ref: string }>(
    integration,
    'SELECT id, creation_ref FROM catalog_items WHERE name=?',
    'Chope Chrome',
  )
  expect(persisted?.id).not.toBe(persisted?.creation_ref)
  expect(persisted?.creation_ref).toMatch(/^tmp:/)
  expect(
    integration.database
      .prepare(
        'SELECT volume_ml,price_cents FROM catalog_variants WHERE item_id=? ORDER BY sort_order',
      )
      .all(persisted.id),
  ).toEqual([
    { volume_ml: 20000, price_cents: 12345 },
    { volume_ml: 7500, price_cents: null },
  ])
  let publicData = await (await page.request.get('/api/catalog')).json()
  expect(
    publicData.categories[0].items.find((i: { id: string }) => i.id === persisted?.id).variants[1]
      .priceCents,
  ).toBeNull()
  item = page.getByRole('listitem', { name: 'Chope Chrome', exact: true })
  await item.getByRole('switch').uncheck()
  await saved(page)
  publicData = await (await page.request.get('/api/catalog')).json()
  expect(publicData.categories[0].items.some((i: { id: string }) => i.id === persisted?.id)).toBe(
    false,
  )
  expect(
    (await (await page.request.get(path)).json()).categories[0].items.find(
      (i: { id: string }) => i.id === persisted?.id,
    ).visible,
  ).toBe(false)
  await add(page, 'Cachaças', 'Cachaca Chrome', '700', '2501')
  await saved(page)
  expect(
    row(
      integration,
      'SELECT volume_ml,price_cents FROM catalog_variants JOIN catalog_items ON item_id=id WHERE name=?',
      'Cachaca Chrome',
    ),
  ).toEqual({ volume_ml: 700, price_cents: 2501 })
  await page.reload()
  await page.getByRole('tab', { name: /Cachaças/ }).click()
  await expect(
    page
      .getByRole('listitem', { name: 'Cachaca Chrome', exact: true })
      .getByLabel('Nome', { exact: true }),
  ).toHaveValue('Cachaca Chrome')
})

test('F: two real Chrome sessions race the same revision, one 200 and one 409', async ({
  page,
  browser,
  integration,
}) => {
  const context = await browser.newContext({ baseURL: integration.origin }),
    other = await context.newPage()
  try {
    await login(page, integration)
    await login(other, integration)
    await price(page).fill('52011')
    await price(other).fill('52022')
    const first = page.waitForResponse(
      (r) => r.url().endsWith(path) && r.request().method() === 'PUT',
    )
    const second = other.waitForResponse(
      (r) => r.url().endsWith(path) && r.request().method() === 'PUT',
    )
    await Promise.all([save(page).click(), save(other).click()])
    const responses = await Promise.all([first, second])
    expect(responses.map((r) => r.status()).sort()).toEqual([200, 409])
    const loser = responses[0].status() === 409 ? page : other
    await expect(loser.getByRole('dialog', { name: 'O catálogo mudou' })).toBeVisible()
    expect(await dbPrice(integration)).toBe(responses[0].status() === 200 ? 52011 : 52022)
  } finally {
    await context.close()
  }
})

test('G: logout revokes session, restores same-user draft; expiration also denies writes', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  await price(page).fill('63039')
  expect(
    (
      await page.request.post('/api/auth/logout', { headers: { Origin: integration.origin } })
    ).status(),
  ).toBe(200)
  const before = await catalogState(integration)
  await save(page).click()
  await expect(page.getByText(/as alterações não salvas ficam guardadas nesta aba/)).toBeVisible()
  expect(await catalogState(integration)).toEqual(before)
  await page.getByLabel('Usuário').fill(integration.username)
  await page.getByLabel('Senha', { exact: true }).fill(integration.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(price(page)).toHaveValue('630,39')
  await expect(page.getByText('Suas alterações não salvas foram restauradas.')).toBeAttached()
  integration.database.prepare('UPDATE admin_sessions SET created_at=1,expires_at=2').run()
  await save(page).click()
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible()
  expect(await catalogState(integration)).toEqual(before)
  expect((await page.request.get(path)).status()).toBe(401)
})

test('H: real Origin rejection explains 403 and retains draft', async ({ page, integration }) => {
  await login(page, integration)
  await price(page).fill('64019')
  const before = await catalogState(integration)
  await page.route(`**${path}`, async (route) => {
    // Forward the genuine handler response; Chrome itself prevents Origin spoofing.
    const response = await route.fetch({
      headers: { ...route.request().headers(), origin: 'https://attacker.invalid' },
    })
    expect(response.status()).toBe(403)
    await route.fulfill({ response })
  })
  const response = page.waitForResponse(
    (r) => r.url().endsWith(path) && r.request().method() === 'PUT',
  )
  await save(page).click()
  expect((await response).status()).toBe(403)
  await expect(page.getByRole('alert')).toContainText('não aceitou a origem')
  await expect(price(page)).toHaveValue('640,19')
  expect(await catalogState(integration)).toEqual(before)
})

for (const where of ['before', 'after'] as const)
  test(`I/J: connection lost ${where} commit, real GET recovery without another PUT`, async ({
    page,
    integration,
  }) => {
    await login(page, integration)
    const before = await dbPrice(integration),
      target = where === 'after' ? '65019' : '65029'
    let puts = 0
    let release = () => {}
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      puts++
      await paused
      if (where === 'after') {
        const r = await route.fetch()
        expect(r.status()).toBe(200)
      }
      await route.abort('failed')
    })
    await price(page).fill(target)
    await save(page).click()
    await expect(price(page)).toBeDisabled()
    release()
    if (where === 'after') {
      await expect(page.getByText('Confirmado: o salvamento anterior foi gravado.')).toBeAttached()
      await expect(page.getByText('Tudo salvo.', { exact: true })).toBeVisible()
      expect(await dbPrice(integration)).toBe(Number(target))
    } else {
      await expect(page.getByRole('alert')).toContainText('Nada foi gravado')
      await expect(price(page)).toHaveValue('650,29')
      expect(await dbPrice(integration)).toBe(before)
    }
    expect(puts).toBe(1)
  })

test('K: uncertain creation plus later edits, guarded removal, exact volume on second save', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  const item = await add(page, 'Chopes', 'Recovery Chrome', '20', '12345')
  let puts = 0,
    blockGet = false
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === 'GET' && blockGet) return route.abort('failed')
    if (route.request().method() !== 'PUT') return route.continue()
    puts++
    if (puts === 1) {
      const r = await route.fetch()
      expect(r.status()).toBe(200)
      blockGet = true
      return route.abort('failed')
    }
    return route.continue()
  })
  await save(page).click()
  await expect(page.getByRole('alert')).toContainText('Ainda não conseguimos confirmar')
  await expect(page.getByRole('button', { name: 'Descartar', exact: true })).toBeDisabled()
  await expect(item.getByRole('button', { name: 'Cancelar cadastro', exact: true })).toBeDisabled()
  await expect(item.getByLabel('Volume (L)', { exact: true }).first()).toBeDisabled()
  await expect(item.getByLabel('Rótulo', { exact: true }).first()).toBeDisabled()
  await expect(item.getByRole('button', { name: 'Adicionar variante', exact: true })).toBeDisabled()
  await item.getByLabel('Nome', { exact: true }).fill('') // Invalid later edit must not block read-only recovery
  await item
    .getByLabel(/^Preço em reais/)
    .first()
    .fill('12789')
  blockGet = false
  await save(page).click()
  await expect(page.getByText('Confirmado: o salvamento anterior foi gravado.')).toBeAttached()
  expect(puts).toBe(1)
  const persisted = page
    .getByRole('listitem')
    .filter({ has: page.getByLabel('Nome', { exact: true }) })
  await expect(persisted.getByLabel('Nome', { exact: true })).toHaveValue('')
  await persisted.getByLabel('Nome', { exact: true }).fill('Recovery edited Chrome')
  await saved(page)
  expect(puts).toBe(2)
  expect(
    row(
      integration,
      'SELECT volume_ml,price_cents FROM catalog_variants JOIN catalog_items ON item_id=id WHERE name=?',
      'Recovery edited Chrome',
    ),
  ).toEqual({ volume_ml: 20000, price_cents: 12789 })
  await page.reload()
  await expect(persisted.getByLabel(/^Preço em reais/).first()).toHaveValue('127,89')
})

test('API unavailability remains an error, with no mock fallback', async ({
  page,
  integration,
}) => {
  await page.route(`**${path}`, (route) => route.abort('failed'))
  await page.goto('/admin?mock=empty')
  await page.getByLabel('Usuário').fill(integration.username)
  await page.getByLabel('Senha', { exact: true }).fill(integration.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Não conseguimos carregar o catálogo', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dronken', exact: true })).toHaveCount(0)
})

test('uncertain result remains recoverable after reverting draft to the old price', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  let puts = 0,
    blockGet = false
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === 'GET' && blockGet) return route.abort('failed')
    if (route.request().method() !== 'PUT') return route.continue()
    puts++
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    blockGet = true
    return route.abort('failed')
  })
  await price(page).fill('60011')
  await save(page).click()
  await expect(page.getByRole('alert')).toContainText('Ainda não conseguimos confirmar')
  await price(page).fill('51000') // identical to the old base, but D1 may have committed
  await expect(save(page)).toBeEnabled()
  blockGet = false
  await save(page).click()
  await expect(page.getByText('Confirmado: o salvamento anterior foi gravado.')).toBeAttached()
  expect(puts).toBe(1)
  expect(await dbPrice(integration)).toBe(60011)
  await expect(price(page)).toHaveValue('510,00')
  await expect(
    page.getByText('1 produto tem alterações não salvas.', { exact: true }),
  ).toBeVisible()
})

async function whatsappMessage(link: Locator) {
  const href = await link.getAttribute('href')
  if (!href) throw new Error('Missing WhatsApp link')
  const url = new URL(href)
  expect(url.hostname).toBe('wa.me')
  return url.searchParams.get('text')
}

test.describe('F3C.4: painel, D1, API, landing e WhatsApp', () => {
  test.use({ whatsappNumber: '5500000000000' })
  for (const width of [1440, 390]) {
    test(`catálogo persistido e pedido em ${width}px`, async ({ page, browser, integration }) => {
      await page.setViewportSize({ width, height: 900 })
      await login(page, integration)
      await price(page).fill('51029')
      await page
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: 'Brahma', exact: true }) })
        .getByRole('switch')
        .uncheck()
      const name = 'Chope Integrado (Novo)'
      const item = await add(page, 'Chopes', name, '20', '12345')
      await item.getByLabel('Rótulo', { exact: true }).fill('Barril especial')
      await item.getByRole('button', { name: 'Adicionar variante' }).click()
      await item.getByLabel('Rótulo', { exact: true }).last().fill('Barril pequeno')
      await item.getByLabel('Volume (L)', { exact: true }).last().fill('7,5')
      await item.getByRole('switch').check()
      await item.getByRole('button', { name: `Subir ${name}`, exact: true }).click()
      await saved(page)
      await page.reload()
      await expect(price(page)).toHaveValue('510,29')
      const chope = row<{ id: string }>(
        integration,
        'SELECT id FROM catalog_items WHERE name=?',
        name,
      )
      const variants = integration.database
        .prepare(
          'SELECT code,volume_ml,price_cents FROM catalog_variants WHERE item_id=? ORDER BY sort_order,code',
        )
        .all(chope.id)
      expect(variants).toMatchObject([
        { volume_ml: 20000, price_cents: 12345 },
        { volume_ml: 7500, price_cents: null },
      ])
      const bottleName = 'Cachaça Integração'
      const bottle = await add(page, 'Cachaças', bottleName, '700', '2501')
      await bottle.getByLabel('Rótulo', { exact: true }).fill('Garrafa especial')
      await bottle.getByRole('button', { name: 'Adicionar variante' }).click()
      await bottle.getByLabel('Rótulo', { exact: true }).last().fill('Garrafa pequena')
      await bottle.getByLabel('Volume (ml)', { exact: true }).last().fill('500')
      await bottle
        .getByLabel(/^Preço em reais/)
        .last()
        .fill('1999')
      await bottle.getByRole('switch').check()
      await saved(page)
      await page.reload()
      await page.getByRole('tab', { name: /Cachaças/ }).click()
      await expect(
        page
          .getByRole('listitem', { name: bottleName, exact: true })
          .getByLabel('Nome', { exact: true }),
      ).toHaveValue(bottleName)
      const anon = await browser.newContext({
        baseURL: integration.origin,
        viewport: { width, height: 900 },
      })
      try {
        const publicData = await (await anon.request.get('/api/catalog')).json()
        expect(publicData.revision).toBe((await (await page.request.get(path)).json()).revision)
        expect(JSON.stringify(publicData)).not.toContain('creationRef')
        const beers = publicData.categories.find((c: { id: string }) => c.id === 'chopes').items
        expect(beers.some((i: { id: string }) => i.id === 'brahma')).toBe(false)
        expect(
          row<{ visible: number }>(
            integration,
            'SELECT visible FROM catalog_items WHERE id=?',
            'brahma',
          ).visible,
        ).toBe(0)
        expect(beers.map((i: { id: string }) => i.id)).toEqual(
          integration.database
            .prepare(
              "SELECT id FROM catalog_items WHERE category_id='chopes' AND visible=1 ORDER BY sort_order,id",
            )
            .all()
            .map((i) => i.id),
        )
        expect(
          beers
            .find((i: { id: string }) => i.id === chope.id)
            .variants.map((v: { code: string; volumeMl: number; priceCents: number | null }) => ({
              code: v.code,
              volume_ml: v.volumeMl,
              price_cents: v.priceCents,
            })),
        ).toEqual(variants)
        const shop = await anon.newPage()
        let reads = 0
        shop.on('request', (r) => {
          if (new URL(r.url()).pathname === '/api/catalog') reads++
        })
        await shop.goto('/')
        await expect(shop.getByTestId('catalog-count-note')).toBeVisible()
        expect(reads).toBe(1)
        const offer =
          width >= 768
            ? shop.locator('tbody tr').filter({ hasText: name })
            : shop.getByRole('article', { name, exact: true })
        await expect(offer).toBeVisible()
        expect(variants.every((v) => typeof v.code === 'string' && v.code.startsWith('v_'))).toBe(
          true,
        )
        expect(
          await offer
            .locator('[data-variant-code]')
            .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-variant-code'))),
        ).toEqual(variants.map((v) => v.code))
        await expect(offer).toContainText('Barril especial · 20 L')
        await expect(offer).toContainText('123,45')
        await expect(offer).toContainText('Barril pequeno · 7,5 L')
        await expect(offer.getByRole('link', { name: /7,5 L/ })).toHaveCount(0)
        // Igualdade exata (NBSP do Intl pt-BR incluído): mensagem completa que o cliente envia.
        expect(await whatsappMessage(offer.getByRole('link', { name: /20 L/ }))).toBe(
          `Olá! Gostaria de pedir ${name}, Barril especial · 20 L, por R$\u00a0123,45.`,
        )
        await expect(shop.locator('[data-item-id="brahma"]')).toHaveCount(0)
        const dronken =
          width >= 768
            ? shop.getByRole('row', { name: /Dronken/ })
            : shop.getByRole('article', { name: 'Dronken', exact: true })
        await expect(dronken).toContainText('510,29')
        expect(await whatsappMessage(dronken.getByRole('link', { name: /30 L/ }))).toBe(
          'Olá! Gostaria de pedir Dronken, Barril de 30 L, por R$\u00a0510,29.',
        )
        const card = shop.getByRole('article', { name: bottleName, exact: true })
        await expect(card.getByRole('link')).toHaveCount(0)
        await card.getByRole('button', { name: /Garrafa especial 700 ml/ }).click()
        expect(await whatsappMessage(card.getByRole('link'))).toBe(
          `Olá! Gostaria de pedir uma garrafa de ${bottleName} Garrafa especial · 700 ml por R$\u00a025,01.`,
        )
        await card.getByRole('button', { name: /Garrafa pequena 500 ml/ }).click()
        expect(await whatsappMessage(card.getByRole('link'))).toBe(
          `Olá! Gostaria de pedir uma garrafa de ${bottleName} Garrafa pequena · 500 ml por R$\u00a019,99.`,
        )
        await expect(shop.getByTestId('age-notice-hero')).toHaveCount(1)
        await expect(shop.getByTestId('age-notice-footer')).toHaveCount(1)
        for (const id of ['chopes', 'barris', 'como', 'faq', 'contato'])
          await expect(shop.locator(`#${id}`)).toHaveCount(1)
        expect(
          await shop.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        ).toBe(0)
        // POLÍTICA ATUAL (caracterização, não decisão comercial): a vitrine não revalida. Se o preço
        // muda no painel com a página aberta, tela e mensagem seguem na mesma captura (510,29).
        await page.getByRole('tab', { name: /Chopes/ }).click()
        await price(page).fill('51099')
        await saved(page)
        await expect(dronken).toContainText('510,29')
        await expect(dronken).not.toContainText('510,99')
        expect(await whatsappMessage(dronken.getByRole('link', { name: /30 L/ }))).toBe(
          'Olá! Gostaria de pedir Dronken, Barril de 30 L, por R$\u00a0510,29.',
        )
        expect(reads).toBe(1)
        await shop.reload()
        await expect(shop.getByTestId('catalog-count-note')).toBeVisible()
        expect(reads).toBe(2)
        await expect(dronken).toContainText('510,99')
        expect(await whatsappMessage(dronken.getByRole('link', { name: /30 L/ }))).toBe(
          'Olá! Gostaria de pedir Dronken, Barril de 30 L, por R$\u00a0510,99.',
        )
        await expect(shop.getByTestId('cachaca-card-cachaca')).toBeVisible()
      } finally {
        await anon.close()
      }
    })
  }
})
test.describe('F3C.4: build normal', () => {
  test.use({ runtimeMode: 'production' })
  test('admin desativado, vitrine real e WhatsApp sem número', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Novo produto', { exact: true })).toHaveCount(0)
    await expect(page.locator('body')).toContainText('administrativo')
    await page.goto('/?preview=catalog')
    await expect(page.getByTestId('catalog-count-note')).toBeVisible()
    await expect(page.getByRole('button', { name: '4. Catálogo Expansível (v2)' })).toHaveCount(0)
    await expect(page.getByTestId('cachaca-card-cachaca')).toBeVisible()
    await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0)
    await page.getByTestId('cachaca-card-cachaca').getByRole('button', { name: /Pedir/ }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'ainda não foi configurado' }),
    ).toBeVisible()
    expect((await page.request.get('/api/admin/catalog/v2')).status()).toBe(401)
    expect(
      (await (await page.request.get('/api/catalog')).json()).categories[0].items,
    ).toHaveLength(8)
  })
})

const CANARIES = {
  CLOUDFLARE_API_TOKEN: 'canary-cloudflare-token',
  CLOUDFLARE_ACCOUNT_ID: 'canary-cloudflare-account',
  CF_API_TOKEN: 'canary-cf-token',
  WRANGLER_API_TOKEN: 'canary-wrangler-token',
  AWS_ACCESS_KEY_ID: 'canary-aws-key',
  AWS_SECRET_ACCESS_KEY: 'canary-aws-secret',
  GITHUB_TOKEN: 'canary-github-token',
  NPM_TOKEN: 'canary-npm-token',
  ADMIN_PASSWORD_PEPPER: 'canary-pepper',
}
test.describe('F3C.5: higiene do ambiente do runtime local', () => {
  test.beforeAll(() => {
    Object.assign(process.env, CANARIES)
  })
  test.afterAll(() => {
    for (const name of Object.keys(CANARIES)) delete process.env[name]
  })
  test('credenciais do operador (Cloudflare, AWS, tokens) não chegam ao servidor descartável', async ({
    integration,
  }) => {
    const keys = integration.envKeys ?? []
    expect(keys.length).toBeGreaterThan(5) // o diagnóstico foi mesmo enviado
    expect(keys).toContain('DELEGAS_INTEGRATION_MODE') // o que foi pedido de forma explícita passou
    for (const name of Object.keys(CANARIES)) expect(keys).not.toContain(name)
    expect(keys.filter((name) => SENSITIVE_NAME.test(name))).toEqual([])
    // O processo do próprio teste continua tendo as variáveis: foi o filho que não as recebeu.
    expect(process.env.CLOUDFLARE_API_TOKEN).toBe('canary-cloudflare-token')
  })
})

test.describe('F3C.5: rótulo com volume negativo, do painel ao WhatsApp', () => {
  test.use({ whatsappNumber: '5500000000000' })
  test('o rótulo fica como foi gravado e o volume canônico vem ao lado, sem tratar -20 L como 20 L', async ({
    page,
    browser,
    integration,
  }) => {
    await login(page, integration)
    const name = 'Chope Rótulo Negativo'
    const item = await add(page, 'Chopes', name, '20', '12345')
    await item.getByLabel('Rótulo', { exact: true }).first().fill('Barril -20 L')
    await item.getByRole('switch').check()
    await saved(page)

    // D1 guarda o rótulo literal e o volume canônico; nada foi "corrigido" em silêncio.
    const stored = integration.database
      .prepare(
        'SELECT v.label, v.volume_ml, v.price_cents FROM catalog_variants v JOIN catalog_items i ON i.id=v.item_id WHERE i.name=?',
      )
      .all(name)
    expect(stored).toMatchObject([{ label: 'Barril -20 L', volume_ml: 20000, price_cents: 12345 }])

    const anon = await browser.newContext({ baseURL: integration.origin })
    try {
      const shop = await anon.newPage()
      await shop.setViewportSize({ width: 1440, height: 900 })
      await shop.goto('/')
      const offer = shop.locator('tbody tr').filter({ hasText: name })
      await expect(offer).toBeVisible()
      await expect(offer).toContainText('Barril -20 L · 20 L')
      await expect(offer.locator('[data-volume-issue="negative"]')).toHaveCount(1)
      expect(await whatsappMessage(offer.getByRole('link', { name: /20 L/ }))).toBe(
        `Olá! Gostaria de pedir ${name}, Barril -20 L · 20 L, por R$ 123,45.`,
      )
      await shop.setViewportSize({ width: 390, height: 900 })
      const card = shop.getByRole('article', { name, exact: true })
      await expect(card).toContainText('Barril -20 L · 20 L')
      expect(await whatsappMessage(card.getByRole('link', { name: /20 L/ }))).toBe(
        `Olá! Gostaria de pedir ${name}, Barril -20 L · 20 L, por R$ 123,45.`,
      )
    } finally {
      await anon.close()
    }
  })
})

test.describe('F3C.5: porta do runner', () => {
  test('o servidor, o navegador e o runner usam a mesma porta NORMALIZADA (padrão 4185 ou DELEGAS_INTEGRATION_PORT)', async ({
    page,
    integration,
  }) => {
    // A porta esperada vem do helper compartilhado, a partir do valor bruto do runner. Comparar
    // com o texto cru reprovaria entradas válidas e normalizadas como "04265".
    const raw = process.env.DELEGAS_INTEGRATION_PORT
    const expected = integrationPort(raw)
    expect(Number(new URL(integration.origin).port)).toBe(expected)
    // O navegador do Playwright navega pelo baseURL da config e cai no servidor descartável.
    await page.goto('/')
    expect(Number(new URL(page.url()).port)).toBe(expected)
    await expect(page.locator('#topo')).toBeVisible()
    const api = await page.request.get('/api/catalog')
    expect(api.status()).toBe(200)
    expect(new URL(api.url()).origin).toBe(integration.origin)
    // Sem a variável (ou vazia) vale 4185; com ela, o valor numérico dela, sem zeros à esquerda.
    expect(expected).toBe(raw ? Number(raw) : 4185)
    // O origin publicado é canônico: nunca "04265".
    expect(integration.origin).toBe(`http://127.0.0.1:${expected}`)
  })
})

test.describe('F3C.5 (2ª rodada): rótulos adversariais, do painel ao WhatsApp', () => {
  test.use({ whatsappNumber: '5500000000000' })

  // U+2063 (separador invisível) passa pela validação de escrita; por isso chega ao D1.
  test('U+2063 escondendo o sinal: D1 guarda o literal, a vitrine mostra o canônico, o link também', async ({
    page,
    browser,
    integration,
  }) => {
    await login(page, integration)
    const name = 'Chope Separador Invisível'
    const label = 'Barril -⁣ 20 L'
    const item = await add(page, 'Chopes', name, '20', '12345')
    await item.getByLabel('Rótulo', { exact: true }).first().fill(label)
    await item.getByRole('switch').check()
    await saved(page)

    const stored = integration.database
      .prepare(
        'SELECT v.label, v.volume_ml FROM catalog_variants v JOIN catalog_items i ON i.id=v.item_id WHERE i.name=?',
      )
      .all(name) as { label: string; volume_ml: number }[]
    expect(stored).toHaveLength(1)
    expect(stored[0].label).toBe(label) // nenhum caractere foi removido ou "consertado"
    expect(stored[0].volume_ml).toBe(20000)

    const anon = await browser.newContext({ baseURL: integration.origin })
    try {
      const api = await (await anon.request.get('/api/catalog')).json()
      const served = api.categories
        .find((c: { id: string }) => c.id === 'chopes')
        .items.find((i: { name: string }) => i.name === name)
      expect(served.variants[0].label).toBe(label) // a API devolve o literal
      expect(served.variants[0].volumeMl).toBe(20000)

      const shop = await anon.newPage()
      await shop.setViewportSize({ width: 1440, height: 900 })
      await shop.goto('/')
      const offer = shop.locator('tbody tr').filter({ hasText: name })
      await expect(offer).toBeVisible()
      await expect(offer).toContainText(`${label} · 20 L`)
      await expect(offer.locator('[data-volume-issue="negative"]')).toHaveCount(1)
      expect(await whatsappMessage(offer.getByRole('link', { name: /20 L/ }))).toBe(
        `Olá! Gostaria de pedir ${name}, ${label} · 20 L, por R$ 123,45.`,
      )
      await shop.setViewportSize({ width: 390, height: 900 })
      const card = shop.getByRole('article', { name, exact: true })
      expect(await whatsappMessage(card.getByRole('link', { name: /20 L/ }))).toBe(
        `Olá! Gostaria de pedir ${name}, ${label} · 20 L, por R$ 123,45.`,
      )
    } finally {
      await anon.close()
    }
  })

  // U+200E/U+200F são controles bidirecionais: o contrato de escrita os recusa, então não chegam ao D1.
  for (const [code, mark] of [
    ['U+200E', '‎'],
    ['U+200F', '‏'],
  ] as const) {
    test(`${code} no rótulo é recusado na escrita: nada é gravado e o rascunho continua`, async ({
      page,
      integration,
    }) => {
      await login(page, integration)
      const name = `Chope Marca ${code}`
      const item = await add(page, 'Chopes', name, '20', '12345')
      await item.getByLabel('Rótulo', { exact: true }).first().fill(`Barril -${mark}20 L`)
      await save(page).click()
      await expect(page.getByRole('alert')).toContainText('O servidor recusou o salvamento')
      const rows = integration.database
        .prepare('SELECT COUNT(*) AS n FROM catalog_items WHERE name=?')
        .get(name) as { n: number }
      expect(rows.n).toBe(0)
      await expect(item.getByLabel('Nome', { exact: true })).toHaveValue(name) // rascunho intacto
      await expect(save(page)).toBeEnabled()
    })
  }
})
