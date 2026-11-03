import { fork } from 'node:child_process'
import { once } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { childEnv, SENSITIVE_NAME } from '../../scripts/clean-env.mts'
import { integrationPort } from '../../scripts/integration-port.mts'
import { cmsDocument } from '../backend/cms-document-fixture'
import { previewFixture } from './preview-fixture'

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
  runtimeMode: 'admin-integration' | 'production' | 'release'
  mediaLab: boolean
  whatsappNumber: string
}>({
  mediaLab: [false, { option: true }],
  runtimeMode: ['admin-integration', { option: true }],
  whatsappNumber: ['', { option: true }],
  integration: [
    async ({ browserName, runtimeMode, whatsappNumber, mediaLab }, use) => {
      if (browserName !== 'chromium') throw new Error('This suite targets local Chrome/Chromium')
      const child = fork('tests/e2e-real/server.mts', [], {
        execArgv: [],
        // Allowlist: o servidor descartável não recebe as credenciais do operador.
        env: childEnv({
          // Explícita e validada: a allowlist não a repassa sozinha, e o servidor precisa ouvir na
          // MESMA porta do baseURL do navegador (playwright.real.config.ts).
          DELEGAS_INTEGRATION_PORT: String(integrationPort()),
          DELEGAS_INTEGRATION_MODE: runtimeMode,
          DELEGAS_MEDIA_LAB: mediaLab ? '1' : '0',
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

test.describe('L0A.1: release seguro', () => {
  test.use({ runtimeMode: 'release' })

  test('rota /admin/ exige sessão; cookie inválido e query mock não liberam o catálogo', async ({
    page,
    context,
  }) => {
    expect((await page.request.get(path)).status()).toBe(401)
    await context.addCookies([
      {
        name: 'delegas_admin_local_session',
        value: 'invalid-session',
        url: `http://127.0.0.1:${integrationPort()}`,
      },
    ])
    await page.goto('/admin/?mock=empty&preview')
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible()
    await expect(page.getByText(/catálogo é fictício/)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Dronken', exact: true })).toHaveCount(0)
    expect((await page.request.get(path)).status()).toBe(401)
    // Stage 2 CMS reads require the same real administrative session.
    expect((await page.request.get('/api/admin/site')).status()).toBe(401)
  })

  test('falha na verificação de sessão permanece erro, sem login ou catálogo fictício', async ({
    page,
  }) => {
    await page.route('**/api/auth/me', (route) => route.abort('failed'))
    await page.goto('/admin?mock=empty')
    await expect(
      page.getByRole('heading', { name: 'Não conseguimos verificar seu acesso' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toHaveCount(0)
    await expect(page.getByText(/catálogo é fictício/)).toHaveCount(0)
  })
})

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

test.describe('Etapa 1: painel real preserva o Conceito C', () => {
  test.use({ whatsappNumber: '5500000000000' })
  for (const width of [390, 1440]) {
    test(`preço persistido chega ao carrossel e catálogo em ${width}px`, async ({
      page,
      browser,
      integration,
    }) => {
      await login(page, integration)
      await price(page).fill('51029')
      await saved(page)
      const context = await browser.newContext({
        baseURL: integration.origin,
        viewport: { width, height: 900 },
      })
      try {
        const shop = await context.newPage()
        await shop.goto('/')
        await expect(shop.locator('#hero-title')).toContainText('O melhor do chopp.')
        await expect(shop.locator('#carousel-track')).toBeVisible()
        await expect(shop.locator('#barris [aria-live="polite"]')).toContainText('Dronken')
        await expect(shop.locator('#carousel-track article[aria-hidden="false"]')).toContainText(
          '510,29',
        )
        await expect(shop.getByRole('row', { name: /Dronken/ })).toContainText('510,29')
        expect(await whatsappMessage(shop.locator('#barris').getByRole('link'))).toBe(
          'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de Dronken (30L).',
        )
        expect(await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        expect((await shop.request.get('/api/admin/site')).status()).toBe(401)
        expect((await shop.request.get('/api/admin/media')).status()).toBe(404)
        expect(
          row<{ n: number }>(
            integration,
            "SELECT count(*) n FROM cms_media_jobs WHERE status='running'",
          ).n,
        ).toBe(0)
      } finally {
        await context.close()
      }
    })
  }
})

test('Etapa 1: controles não alteram o rascunho durante PUT pendente', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === 'PUT') await gate
    await route.continue()
  })
  await price(page).fill('61234')
  const requested = page.waitForRequest(
    (request) => request.url().endsWith(path) && request.method() === 'PUT',
  )
  await save(page).click()
  await requested
  try {
    await expect(price(page)).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Novo produto', exact: true })).toBeDisabled()
    await expect(page.getByRole('switch').first()).toBeDisabled()
  } finally {
    release()
  }
  await expect(page.getByText('Tudo salvo.', { exact: true })).toBeVisible()
  expect(await dbPrice(integration)).toBe(61234)
})

test('rejeição antecipada mantém 401/403; contexto independente verifica 405 sem retry', async ({
  page,
  playwright,
  integration,
}) => {
  const before = await (await page.request.get('/api/catalog')).json()
  const denied = await page.request.put(path, {
    headers: { Origin: integration.origin, 'If-Match': `"${before.revision}"` },
    data: { revision: before.revision, categories: [] },
    maxRetries: 0,
  })
  expect(denied.status()).toBe(401)
  expect((await denied.json()).error.code).toBe('UNAUTHENTICATED')
  const isolated = await playwright.request.newContext({ baseURL: integration.origin })
  try {
    const method = await isolated.post(path, { maxRetries: 0 })
    expect(method.status()).toBe(405)
    expect(method.headers().allow).toBe('GET, PUT')
    expect(await (await isolated.get('/api/catalog')).json()).toEqual(before)
    const csrf = await isolated.put(path, {
      headers: { Origin: 'https://invalid.example', 'If-Match': `"${before.revision}"` },
      data: { revision: before.revision, categories: [] },
      maxRetries: 0,
    })
    expect(csrf.status()).toBe(403)
    expect((await csrf.json()).error.code).toBe('INVALID_ORIGIN')
  } finally {
    await isolated.dispose()
  }
})

test('F4A.1: rascunho autenticado, resposta perdida, replay, CSRF e catálogo isolado', async ({
  page,
  integration,
  browser,
}) => {
  expect((await page.request.get('/api/admin/site')).status()).toBe(401)
  await login(page, integration)
  const before = await (await page.request.get('/api/catalog')).json()
  const initialResponse = await page.request.get('/api/admin/site')
  expect(initialResponse.status()).toBe(200)
  const initial = await initialResponse.json()
  expect(initial.draft.document).toBeNull()
  expect(initial.published).toBeNull()
  const input = {
    action: 'saveDraft',
    expectedRevision: initial.draft.revision,
    operationId: crypto.randomUUID(),
    document: cmsDocument(),
  }
  Object.assign(input.document.modules[0].content, { heading: 'Rascunho privado Etapa 2' })
  await page.route('**/api/admin/site/draft', async (route) => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    await route.abort('failed')
  })
  const lost = await page.evaluate(async (command) => {
    try {
      await fetch('/api/admin/site/draft', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${command.expectedRevision}"`,
        },
        body: JSON.stringify(command),
      })
      return false
    } catch {
      return true
    }
  }, input)
  expect(lost).toBe(true)
  const recoveredResponse = await page.request.get(`/api/admin/site/commands/${input.operationId}`)
  expect(recoveredResponse.status()).toBe(200)
  expect(recoveredResponse.headers()['cache-control']).toBe('no-store')
  const recovered = await recoveredResponse.json()
  expect(recovered.site.draft.document).toEqual(input.document)
  const headers = { Origin: integration.origin, 'If-Match': `"${input.expectedRevision}"` }
  const replay = await page.request.put('/api/admin/site/draft', { headers, data: input })
  expect(replay.status()).toBe(200)
  expect(await replay.json()).toEqual(recovered)
  const conflicting = { ...input, operationId: crypto.randomUUID() }
  expect(
    (await page.request.put('/api/admin/site/draft', { headers, data: conflicting })).status(),
  ).toBe(409)
  expect(
    (
      await page.request.put('/api/admin/site/draft', {
        headers: { ...headers, Origin: 'https://evil.invalid' },
        data: input,
      })
    ).status(),
  ).toBe(403)
  const stranger = await browser.newContext()
  try {
    expect(
      (
        await stranger.request.get(
          `${integration.origin}/api/admin/site/commands/${input.operationId}`,
        )
      ).status(),
    ).toBe(401)
  } finally {
    await stranger.close()
  }
  expect(row<{ n: number }>(integration, 'SELECT COUNT(*) AS n FROM cms_versions').n).toBe(1)
  expect(row<{ n: number }>(integration, 'SELECT COUNT(*) AS n FROM cms_media_refs').n).toBe(0)
  expect(row(integration, 'SELECT published_version_id,published_revision FROM cms_state')).toEqual(
    { published_version_id: null, published_revision: null },
  )
  expect(await (await page.request.get('/api/catalog')).json()).toEqual(before)
  // Exercise unavailable routes through the real browser transport; see local diagnostic evidence.
  const unavailable = await page.evaluate(async (command) => {
    const headers = {
      'Content-Type': 'application/json',
      'If-Match': `"${command.expectedRevision}"`,
    }
    const publish = await fetch('/api/admin/site/publish', {
      method: 'PUT',
      headers,
      body: JSON.stringify(command),
    })
    await publish.text()
    const media = await fetch('/api/admin/site/media', { method: 'POST', headers, body: '{}' })
    await media.text()
    return { publish: publish.status, media: media.status }
  }, input)
  expect(unavailable.publish).toBe(404)
  expect(unavailable.media).toBe(404)
  const publicContext = await browser.newContext({ baseURL: integration.origin })
  try {
    for (const endpoint of ['/api/site', '/api/cms', '/api/admin/site/publish', '/api/admin/media'])
      expect((await publicContext.request.get(endpoint)).status()).toBe(404)
    expect((await publicContext.request.get('/api/admin/site')).status()).toBe(401)
    expect(
      (await publicContext.request.get(`/api/admin/site/commands/${input.operationId}`)).status(),
    ).toBe(401)
    const shop = await publicContext.newPage()
    const cmsRequests: string[] = []
    shop.on('request', (request) => {
      if (/\/api\/(?:admin\/site|site|cms)(?:[/?]|$)/.test(request.url()))
        cmsRequests.push(request.url())
    })
    await shop.goto('/')
    await expect(shop.getByRole('heading', { level: 1 })).toContainText('O melhor do chopp.')
    await expect(shop.getByText('Rascunho privado Etapa 2', { exact: true })).toHaveCount(0)
    await expect(shop.locator('tbody tr')).toHaveCount(8)
    expect(cmsRequests).toEqual([])
    expect(await (await shop.request.get('/api/catalog')).json()).toEqual(before)
  } finally {
    await publicContext.close()
  }
})

test.describe('F4A.2A: disposable private media library', () => {
  test.use({ mediaLab: true })
  test('Chrome uploads through Pages, recovers receipt, protects references and exposes no bytes', async ({
    page,
    integration,
  }) => {
    const sharp = (await import('sharp')).default
    const bytes = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#803020' },
    })
      .withMetadata()
      .png()
      .toBuffer()
    const encoded = bytes.toString('base64'),
      operation = crypto.randomUUID(),
      id = `media_${operation}`
    await page.goto('/')
    const post = () =>
      page.evaluate(
        async ({ encoded, operation }) => {
          const response = await fetch('/api/admin/media', {
            method: 'POST',
            headers: {
              'Content-Type': 'image/png',
              'X-Operation-Id': operation,
              'If-None-Match': '*',
            },
            body: Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
          })
          return {
            status: response.status,
            body: (await response.json()) as { media: { state: string } },
          }
        },
        { encoded, operation },
      )
    expect((await post()).status).toBe(401)
    await login(page, integration)
    await page.route('**/api/admin/media', async (route) => {
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('failed')
    })
    await expect(post()).rejects.toThrow()
    await page.unroute('**/api/admin/media')
    const response = await post()
    expect(response.status).toBe(200)
    expect(response.body.media.state).toBe('ready')
    expect(JSON.stringify(response.body)).not.toMatch(/objectKey|sha256|quarantine|actor|session/)
    expect((await post()).status).toBe(200)
    expect(row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_media_jobs').n).toBe(1)
    expect(
      row<{ state: string }>(integration, 'SELECT state FROM cms_media WHERE media_id=?', id).state,
    ).toBe('ready')
    const snapshot = await (await page.request.get('/api/admin/site')).json()
    const document = cmsDocument(),
      hero = document.modules.find((m) => m.template === 'hero')
    if (hero?.template !== 'hero') throw Error('fixture')
    hero.content.media = { id, alt: 'foto' }
    expect(
      (
        await page.request.put('/api/admin/site/draft', {
          headers: { Origin: integration.origin, 'If-Match': `"${snapshot.draft.revision}"` },
          data: {
            action: 'saveDraft',
            operationId: crypto.randomUUID(),
            expectedRevision: snapshot.draft.revision,
            document,
          },
        })
      ).status(),
    ).toBe(200)
    const removed = await page.evaluate(
      async ({ id, operation }) =>
        (
          await fetch(`/api/admin/media/${id}`, {
            method: 'DELETE',
            headers: { 'X-Operation-Id': crypto.randomUUID(), 'If-Match': `"${operation}"` },
          })
        ).status,
      { id, operation },
    )
    expect(removed).toBe(409)
    const privateRoute = await page.evaluate(async (id) => {
      const r = await fetch(`/api/media/${id}`)
      return { status: r.status, type: r.headers.get('content-type') }
    }, id)
    expect(privateRoute.status).toBe(404)
    expect(privateRoute.type).not.toBe('image/webp')
    expect(
      row<{ published_version_id: null }>(integration, 'SELECT published_version_id FROM cms_state')
        .published_version_id,
    ).toBeNull()
  })
})

test('CP3: Pages serves private v2 conversion, immutable receipts and preserves catalog', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  const before = await (await page.request.get('/api/catalog')).json()
  const initial = await (await page.request.get('/api/admin/site')).json()
  expect(initial.schema).toBeNull()
  const v1 = {
    action: 'saveDraft',
    expectedRevision: initial.draft.revision,
    operationId: crypto.randomUUID(),
    document: cmsDocument(),
  }
  const first = await page.request.put('/api/admin/site/draft', {
    headers: { Origin: integration.origin, 'If-Match': `"${v1.expectedRevision}"` },
    data: v1,
  })
  expect(first.status()).toBe(200)
  const saved = await first.json()
  const input = {
    action: 'convertToV2',
    expectedRevision: saved.command.revision,
    operationId: crypto.randomUUID(),
  }
  const headers = { Origin: integration.origin, 'If-Match': `"${input.expectedRevision}"` }
  const preview = await page.request.post('/api/admin/site/convert', {
    headers,
    data: { ...input, action: 'previewConversion' },
  })
  expect(preview.status()).toBe(200)
  const proposed = await preview.json()
  const converted = await page.request.post('/api/admin/site/convert', { headers, data: input })
  expect(converted.status()).toBe(200)
  const receipt = await converted.json()
  expect(receipt.site.schema).toBe(2)
  expect(receipt.site.draft.document).toEqual(proposed.preview.document)
  const next = {
    action: 'saveDraft',
    expectedRevision: receipt.command.revision,
    operationId: crypto.randomUUID(),
    document: structuredClone(receipt.site.draft.document),
  }
  next.document.modules[0].content.heading = 'Private CP3 edit'
  expect(
    (
      await page.request.put('/api/admin/site/draft', {
        headers: { Origin: integration.origin, 'If-Match': `"${next.expectedRevision}"` },
        data: next,
      })
    ).status(),
  ).toBe(200)
  expect(
    await (await page.request.post('/api/admin/site/convert', { headers, data: input })).json(),
  ).toEqual(receipt)
  expect(
    await (await page.request.get(`/api/admin/site/commands/${input.operationId}`)).json(),
  ).toEqual(receipt)
  expect(
    await (await page.request.get(`/api/admin/site/commands/${v1.operationId}`)).json(),
  ).toEqual(saved)
  expect(await (await page.request.get('/api/catalog')).json()).toEqual(before)
  expect(
    row(integration, 'SELECT published_version_id,published_revision FROM cms_v2_state'),
  ).toEqual({ published_version_id: null, published_revision: null })
})

// P2: exercise the actual Pages asset handler and authenticated API in both build modes.
for (const mode of ['production', 'release'] as const) {
  test.describe(`P2: admin response isolation (${mode})`, () => {
    test.use({ runtimeMode: mode })

    test('Pages headers, deep SPA assets and CSP protect reserved admin paths', async ({
      page,
      context,
      integration,
    }) => {
      const paths = ['/admin', '/admin/preview', '/admin/preview/frame']
      for (const pathname of paths) {
        const response = await page.request.get(pathname)
        expect(response.status()).toBe(pathname === '/admin' ? 200 : 401)
        const headers = response.headers()
        expect(headers['content-type']).toContain('text/html')
        expect(headers['cache-control']).toBe('no-store')
        expect(headers['x-robots-tag']).toBe('noindex, nofollow')
        expect(headers['referrer-policy']).toBe('no-referrer')
        expect(headers['x-content-type-options']).toBe('nosniff')
        const csp = headers['content-security-policy']
        for (const directive of [
          "script-src 'self'",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          pathname === '/admin/preview' ? "frame-ancestors 'none'" : "frame-ancestors 'self'",
        ]) {
          expect(csp.split(';').map((part) => part.trim())).toContain(directive)
        }
        const html = await response.text()
        const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
        if (pathname === '/admin') expect(scripts.length).toBeGreaterThan(0)
        else {
          expect(scripts).toHaveLength(0)
          expect(html).toContain('Sessão necessária')
        }
        for (const script of scripts) {
          const asset = await page.request.get(new URL(script[1], response.url()).href)
          expect(asset.status()).toBe(200)
          expect(asset.headers()['content-type']).toMatch(/javascript/)
        }
      }
      for (const path of ['/api/admin/site', '/api/admin/site/commands/private-operation']) {
        const response = await page.request.get(path)
        expect(response.status()).toBe(401)
        expect(response.headers()['cache-control']).toBe('no-store')
        expect(await response.text()).not.toMatch(/objectKey|passwordHash|csrfToken|"document"/)
      }
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript(() => {
        Object.assign(window, { p2Violations: [] as string[], p2InlineExecuted: false })
        window.document.addEventListener('securitypolicyviolation', (event) => {
          ;(window as unknown as { p2Violations: string[] }).p2Violations.push(
            event.effectiveDirective,
          )
        })
      })
      const privateHeading = 'PRIVATE-P2-DRAFT-NOT-FOR-HTML'
      const authenticated = await page.request.post('/api/auth/login', {
        headers: { Origin: integration.origin },
        data: { username: integration.username, password: integration.password },
      })
      expect(authenticated.status()).toBe(200)
      const snapshot = await (await page.request.get('/api/admin/site')).json()
      const document = cmsDocument()
      Object.assign(document.modules[0].content, { heading: privateHeading })
      const saved = await page.request.put('/api/admin/site/draft', {
        headers: { Origin: integration.origin, 'If-Match': `"${snapshot.draft.revision}"` },
        data: {
          action: 'saveDraft',
          expectedRevision: snapshot.draft.revision,
          operationId: crypto.randomUUID(),
          document,
        },
      })
      expect(saved.status()).toBe(200)
      expect((await saved.json()).site.draft.document).toEqual(document)
      await context.clearCookies()
      expect((await page.request.get('/api/admin/site')).status()).toBe(401)
      for (const pathname of paths) {
        const response = await page.goto(pathname)
        expect(await response?.text()).not.toContain(privateHeading)
        if (pathname === '/admin' && mode === 'release') {
          await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible()
        } else if (pathname !== '/admin') {
          // P4 adds a server-authenticated shell on these previously reserved paths.
          expect(response?.status()).toBe(401)
          await expect(page.getByRole('heading', { name: 'Sessão necessária' })).toBeVisible()
        } else {
          await expect(page.getByRole('heading', { name: 'Painel indisponível' })).toBeVisible()
        }
        expect(
          await page.evaluate(() => (window as unknown as { p2Violations: string[] }).p2Violations),
        ).toEqual([])
        expect(new URL(page.url()).search).toBe('')
        expect(await page.locator('body').innerText()).not.toContain(privateHeading)
        expect(await page.locator('body').innerText()).not.toMatch(
          /objectKey|passwordHash|csrfToken/,
        )
      }
      await page.evaluate(() => {
        const script = window.document.createElement('script')
        script.textContent = 'window.p2InlineExecuted = true'
        window.document.body.appendChild(script)
        const element = window.document.createElement('div')
        element.id = 'p2-style-check'
        element.style.width = '37px'
        window.document.body.appendChild(element)
      })
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { p2Violations: string[] }).p2Violations),
        )
        .toContain('script-src-elem')
      expect(
        await page.evaluate(
          () => (window as unknown as { p2InlineExecuted: boolean }).p2InlineExecuted,
        ),
      ).toBe(false)
      await expect(page.locator('#p2-style-check')).toHaveCSS('width', '37px')
      // A data URL cannot make a network call, but still exercises connect-src enforcement.
      expect(
        await page.evaluate(async () => {
          try {
            await fetch('data:text/plain,p2-blocked')
            return 'allowed'
          } catch {
            return 'blocked'
          }
        }),
      ).toBe('blocked')
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { p2Violations: string[] }).p2Violations),
        )
        .toContain('connect-src')
      expect(errors).toEqual([])
      const publicResponse = await page.request.get('/')
      expect(publicResponse.status()).toBe(200)
      expect(await publicResponse.text()).not.toContain(privateHeading)
      expect(publicResponse.headers()['content-security-policy']).toBeUndefined()
      expect((await page.request.get('/administrator')).headers()['x-robots-tag']).toBeUndefined()
    })
  })
}

async function seedPreview(page: Page, instance: Integration) {
  await login(page, instance)
  const initial = await (await page.request.get('/api/admin/site')).json()
  const response = await page.request.post('/api/admin/site/convert', {
    headers: { Origin: instance.origin, 'If-Match': `"${initial.draft.revision}"` },
    data: {
      action: 'startV2',
      operationId: crypto.randomUUID(),
      expectedRevision: initial.draft.revision,
      document: previewFixture(),
    },
  })
  expect(response.status()).toBe(200)
  return response.json()
}

test('P4: server-authenticated shell and frame reject anonymous access and token URLs', async ({
  page,
  integration,
}) => {
  for (const path of [
    '/admin/preview',
    '/admin/preview/',
    '/admin/preview/frame',
    '/admin/preview/frame/',
    '/admin/preview/frame?token=not-a-session',
  ]) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(401)
    expect(response?.headers()['cache-control']).toBe('no-store')
    expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow')
    await expect(page.getByRole('link', { name: 'Entrar no painel' })).toBeVisible()
    expect(await response?.text()).not.toContain('Rascunho privado P4')
    expect(await response?.text()).not.toContain('<script')
  }
  await page
    .context()
    .addCookies([
      { name: 'delegas_admin_local_session', value: 'invalid', url: integration.origin },
    ])
  expect((await page.request.get('/admin/preview/frame')).status()).toBe(401)
  const head = await page.request.head('/admin/preview/frame')
  expect(head.status()).toBe(401)
  expect(await head.text()).toBe('')
  expect((await page.request.post('/admin/preview')).status()).toBe(405)
})

test('P4: no v2 document instructs without conversion or editorial writes', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  const before = await (await page.request.get('/api/admin/site')).json()
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/site') && request.method() !== 'GET')
      writes.push(request.method())
  })
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/admin/site', async (route) => {
    await gate
    await route.continue()
  })
  await page.goto('/admin/preview')
  await expect(page.getByText('Carregando rascunho autenticado…')).toBeVisible()
  release()
  await expect(page.getByRole('heading', { name: 'Documento CMS v2 necessário' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(before)
  expect(writes).toEqual([])
  const saved = await page.request.put('/api/admin/site/draft', {
    headers: { Origin: integration.origin, 'If-Match': `"${before.draft.revision}"` },
    data: {
      action: 'saveDraft',
      expectedRevision: before.draft.revision,
      operationId: crypto.randomUUID(),
      document: cmsDocument(),
    },
  })
  expect(saved.status()).toBe(200)
  const v1 = await (await page.request.get('/api/admin/site')).json()
  expect(v1.schema).toBe(1)
  await page.getByRole('button', { name: 'Atualizar prévia' }).click()
  await expect(page.getByRole('heading', { name: 'Documento CMS v2 necessário' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(v1)
  expect(writes).toEqual([])
})

test('E5: Página inicial lê o CMS real sem documento e com rascunho v1, sem nenhuma escrita', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  const before = await (await page.request.get('/api/admin/site')).json()
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/site') && request.method() !== 'GET')
      writes.push(request.method())
  })
  await page.goto('/admin#pagina-inicial')
  await expect(
    page.getByRole('heading', { name: 'Ainda não há documento da página inicial' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /criar|inicializar|converter/i })).toHaveCount(0)
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(before)

  const saved = await page.request.put('/api/admin/site/draft', {
    headers: { Origin: integration.origin, 'If-Match': `"${before.draft.revision}"` },
    data: {
      action: 'saveDraft',
      expectedRevision: before.draft.revision,
      operationId: crypto.randomUUID(),
      document: cmsDocument(),
    },
  })
  expect(saved.status()).toBe(200)
  const v1 = await (await page.request.get('/api/admin/site')).json()
  expect(v1.schema).toBe(1)
  await page.getByRole('button', { name: 'Atualizar' }).click()
  await expect(
    page.getByRole('heading', { name: 'O rascunho está no formato antigo (v1)' }),
  ).toBeVisible()
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(v1)
  expect(writes).toEqual([])
})

test('E5: Página inicial mostra o documento v2 real com ids e ordem do servidor', async ({
  page,
  integration,
}) => {
  const seeded = await seedPreview(page, integration)
  const document = seeded.site.draft.document
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/site') && request.method() !== 'GET')
      writes.push(request.method())
  })
  await page.goto('/admin#pagina-inicial')
  await expect(page.getByRole('heading', { level: 1, name: 'Página inicial' })).toBeVisible()
  const sections = page.getByRole('navigation', { name: 'Seções da página inicial' })
  await expect(sections.getByRole('button')).toHaveCount(document.modules.length)
  await expect(sections.getByRole('button').first()).toContainText(
    document.modules[0].content.heading,
  )
  const second = document.modules[1]
  await sections.getByRole('button').nth(1).click()
  await expect(page.getByText(second.id, { exact: true })).toBeVisible()
  await expect(page.getByText('Revisão c2_', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Abrir prévia' })).toHaveAttribute(
    'href',
    '/admin/preview',
  )
  // O GET pode trazer `warnings`, que o resultado do comando não tem: o que não pode mudar é o rascunho.
  const after = await (await page.request.get('/api/admin/site')).json()
  expect({ schema: after.schema, draft: after.draft }).toEqual({
    schema: seeded.site.schema,
    draft: seeded.site.draft,
  })
  expect(writes).toEqual([])
})

test.describe('P4: configured commercial actions remain inert', () => {
  test.use({ whatsappNumber: '5532999999999' })
  test('P4: valid v2 iframe has real desktop/mobile viewports, derived navigation and inert commerce', async ({
    page,
    integration,
  }, testInfo) => {
    await seedPreview(page, integration)
    const writes: string[] = [],
      errors: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/admin/site') && request.method() !== 'GET')
        writes.push(request.method())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1600, height: 1100 })
    const response = await page.goto('/admin/preview')
    expect(response?.headers()['content-security-policy']).toContain(
      `${integration.origin}/admin/preview/frame`,
    )
    expect(await response?.text()).not.toContain('Rascunho privado P4')
    await expect(
      page.getByText('Rascunho não publicado · Somente leitura', { exact: false }),
    ).toBeVisible()
    const frame = page.frameLocator('iframe[title="Rascunho CMS v2"]')
    await expect(
      frame.getByRole('heading', { level: 1, name: 'Rascunho privado P4' }),
    ).toBeVisible()
    expect(await frame.locator('body').evaluate(() => innerWidth)).toBe(1440)
    await expect(page.locator('iframe')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin',
    )
    expect(
      await frame
        .locator('[data-cms-template]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-cms-template'))),
    ).toEqual([
      'hero',
      'carousel',
      'ticker',
      'catalog',
      'faq',
      'about',
      'how',
      'highlight',
      'highlight',
      'contact',
    ])
    const ids = await frame.locator('[id]').evaluateAll((nodes) => nodes.map((n) => n.id))
    expect(new Set(ids).size).toBe(ids.length)
    await expect(frame.locator('a[href*="wa.me"]')).toHaveCount(0)
    const orderButtons = frame.getByRole('button', { name: 'Pedir no WhatsApp', exact: true })
    await expect(orderButtons).toHaveCount(2)
    for (const button of await orderButtons.all()) await expect(button).toBeDisabled()
    await expect(
      frame.getByRole('button', { name: 'Pedir Barril Dronken no WhatsApp' }),
    ).toBeDisabled()
    const rawFrame = page.frames().find((f) => new URL(f.url()).pathname === '/admin/preview/frame')
    expect(rawFrame).toBeDefined()
    await rawFrame?.evaluate(() => document.fonts.ready)
    // Cada documento tem o seu tema: o shell do painel usa o tema do painel e o iframe, que é a
    // página pública em prévia, usa o pastel. Os dois têm o mesmo fundo creme, sem vazar um no outro.
    const readDocument = () => ({
      theme: document.documentElement.dataset.theme ?? null,
      background: getComputedStyle(document.documentElement).backgroundColor,
    })
    const cream = 'rgb(250, 245, 234)'
    expect(await page.evaluate(readDocument)).toEqual({ theme: 'admin', background: cream })
    expect(await rawFrame?.evaluate(readDocument)).toEqual({ theme: 'pastel', background: cream })
    await testInfo.attach('preview-desktop', {
      body: await page.locator('iframe').screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await testInfo.attach('preview-shell', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await page.getByRole('button', { name: 'Mobile · 390px' }).click()
    expect(await frame.locator('body').evaluate(() => innerWidth)).toBe(390)
    await testInfo.attach('preview-mobile', {
      body: await page.locator('iframe').screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await frame.getByRole('button', { name: 'Abrir menu' }).click()
    await frame
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: 'Barris 3D' })
      .click()
    await expect(frame.locator('#barris')).toBeInViewport()
    await frame.getByRole('button', { name: 'Próximo Barril' }).click()
    await expect(
      frame.locator('[aria-live="polite"]').filter({ hasText: 'Heineken' }),
    ).toBeVisible()
    await expect(
      frame.getByRole('button', { name: 'Pedir Barril Heineken no WhatsApp' }),
    ).toBeDisabled()
    if (!rawFrame) throw new Error('Frame required')
    await rawFrame.evaluate(() => {
      Object.assign(window, { p4Blocked: [] as string[] })
      window.document.addEventListener('securitypolicyviolation', (event) => {
        ;(window as unknown as { p4Blocked: string[] }).p4Blocked.push(event.effectiveDirective)
      })
      const nested = window.document.createElement('iframe')
      nested.src = '/'
      window.document.body.appendChild(nested)
    })
    await expect
      .poll(() => rawFrame.evaluate(() => (window as unknown as { p4Blocked: string[] }).p4Blocked))
      .toContain('frame-src')
    await page.evaluate(() => {
      Object.assign(window, { p4ParentBlocked: [] as string[] })
      window.document.addEventListener('securitypolicyviolation', (event) => {
        ;(window as unknown as { p4ParentBlocked: string[] }).p4ParentBlocked.push(
          event.effectiveDirective,
        )
      })
      const forbidden = window.document.createElement('iframe')
      forbidden.id = 'p4-forbidden-frame'
      forbidden.src = '/admin'
      window.document.body.appendChild(forbidden)
    })
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { p4ParentBlocked: string[] }).p4ParentBlocked),
      )
      .toContain('frame-src')
    await page.locator('#p4-forbidden-frame').evaluate((node) => node.remove())
    expect(writes).toEqual([])
    expect(errors).toEqual([])
    const publicPage = await page.request.get('/')
    expect(await publicPage.text()).not.toContain('Rascunho privado P4')
    expect(new URL(page.url()).search).toBe('')
  })
})

test('P4: errors and malformed authenticated drafts fail closed; logout removes rendered content', async ({
  page,
  integration,
}) => {
  await seedPreview(page, integration)
  await page.route('**/api/admin/site', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  )
  await page.goto('/admin/preview')
  await expect(page.getByRole('heading', { name: 'Prévia indisponível' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.unroute('**/api/admin/site')
  await page.route('**/api/admin/site', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.draft.document.modules[0].content.priceCents = 1
    await route.fulfill({ response, json: body })
  })
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(page.getByRole('heading', { name: 'Prévia indisponível' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.unroute('**/api/admin/site')
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Rascunho privado P4' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect((await page.request.get('/admin/preview/frame')).status()).toBe(401)
  expect((await page.request.get('/api/admin/site')).status()).toBe(401)
})

test('P4: frame API corruption clears private DOM and missing/hidden products are diagnosed', async ({
  page,
  integration,
}) => {
  await seedPreview(page, integration)
  await page.route('**/api/catalog', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const category of body.categories)
      category.items = category.items.filter((item: { id: string }) => item.id !== 'heineken')
    const item = body.categories
      .find((category: { id: string }) => category.id === 'chopes')
      ?.items.find((item: { id: string }) => item.id === 'dronken')
    if (item)
      item.variants = [
        { code: 'p4-fraction', label: '1,5 L', volumeMl: 1500, priceCents: 12345 },
        { code: 'p4-30', label: '30 L', volumeMl: 30000, priceCents: 51000 },
      ]
    await route.fulfill({ response, json: body })
  })
  const mediaRequests: string[] = []
  page.on('request', (request) => {
    if (/\/api\/admin\/media|media_12345678/.test(request.url())) mediaRequests.push(request.url())
  })
  await page.route('**/api/admin/site', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    const media = {
      id: 'media_12345678-1234-4123-8123-123456789012',
      alt: 'Imagem privada de laboratório',
    }
    body.draft.document.modules.find(
      (m: { template: string }) => m.template === 'hero',
    ).content.media = media
    body.draft.document.modules.find(
      (m: { template: string }) => m.template === 'about',
    ).content.media = media
    body.draft.document.modules.find(
      (m: { template: string }) => m.template === 'carousel',
    ).content.entries[0].media = media
    await route.fulfill({ response, json: body })
  })
  await page.goto('/admin/preview')
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'Rascunho privado P4' })).toBeVisible()
  await expect(frame.getByText('Itens ausentes ou ocultos no catálogo: heineken')).toBeVisible()
  await expect(
    frame.getByRole('button', { name: 'Pedir Barril Dronken no WhatsApp' }),
  ).toBeDisabled()
  await expect(frame.getByRole('img', { name: 'Mídia privada não carregada' })).toHaveCount(3)
  expect(mediaRequests).toEqual([])
  const fraction = frame.getByRole('button', { name: /Selecionar.*1,5.*123,45/ })
  await expect(fraction).not.toHaveClass(/priceSelected/)
  await fraction.click()
  await expect(fraction).toHaveClass(/priceSelected/)
  await page.route('**/api/admin/site', (route) => {
    if (new URL(route.request().frame().url()).pathname !== '/admin/preview/frame')
      return route.continue()
    return route.fulfill({
      status: 200,
      json: { schema: 2, draft: { revision: 'invalid', document: {} }, published: null },
    })
  })
  const child = page.frames().find((f) => new URL(f.url()).pathname === '/admin/preview/frame')
  await child?.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(frame.getByRole('heading', { name: 'Prévia indisponível' })).toBeVisible()
  await expect(frame.getByRole('heading', { name: 'Rascunho privado P4' })).toHaveCount(0)
  await page.unroute('**/api/admin/site')
  expect(
    (
      await page.request.post('/api/auth/logout', { headers: { Origin: integration.origin } })
    ).status(),
  ).toBe(200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(
    page.getByText('Sua sessão expirou. Entre novamente.', { exact: true }),
  ).toBeVisible()
})
