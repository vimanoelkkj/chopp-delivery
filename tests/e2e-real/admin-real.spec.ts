import { fork } from 'node:child_process'
import { once } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test as base, expect, type Page } from '@playwright/test'

type Ready = {
  origin: string
  username: string
  password: string
  directory: string
  error?: string
}
type Integration = Ready & { database: DatabaseSync }
const test = base.extend<{ integration: Integration }>({
  integration: [
    async ({ browserName }, use) => {
      if (browserName !== 'chromium') throw new Error('This suite targets local Chrome/Chromium')
      const child = fork('tests/e2e-real/server.mts', [], {
        execArgv: [],
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
