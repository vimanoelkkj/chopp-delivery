import { fork } from 'node:child_process'
import { once } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test as base, expect, type Locator, type Page, type Route } from '@playwright/test'
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
        expect(
          (await whatsappMessage(shop.locator('#barris').getByRole('link')))?.replaceAll(' ', ' '),
        ).toBe(
          'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de Dronken (30L). Quantidade: 1 unidade. Preço unitário: R$ 510,29. Total: R$ 510,29.',
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
  // A rota de publicação existe (POST) desde 7117f00; PUT é método errado, não rota ausente.
  expect(unavailable.publish).toBe(405)
  expect(unavailable.media).toBe(404)
  const publicContext = await browser.newContext({ baseURL: integration.origin })
  try {
    for (const endpoint of ['/api/site', '/api/cms', '/api/admin/media'])
      expect((await publicContext.request.get(endpoint)).status()).toBe(404)
    // Publicação: o método é validado antes da autenticação (POST apenas).
    expect((await publicContext.request.get('/api/admin/site/publish')).status()).toBe(405)
    expect((await publicContext.request.get('/api/admin/site')).status()).toBe(401)
    expect(
      (await publicContext.request.get(`/api/admin/site/commands/${input.operationId}`)).status(),
    ).toBe(401)
    const shop = await publicContext.newPage()
    const cmsRequests: string[] = []
    shop.on('request', (request) => {
      // /api/site e /api/cms são públicos (só conteúdo publicado) desde 7117f00; o rascunho é admin.
      if (/\/api\/admin\/site(?:[/?]|$)/.test(request.url())) cmsRequests.push(request.url())
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
  test('Chrome uploads through Pages, queries receipts, serves private derivatives and protects references', async ({
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
    for (const path of [
      '/api/admin/media',
      `/api/admin/media/${id}/hero`,
      `/api/admin/media/commands/${operation}`,
    ])
      expect((await page.request.get(path)).status()).toBe(401)
    await login(page, integration)
    await page.route('**/api/admin/media', async (route) => {
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('failed')
    })
    await expect(post()).rejects.toThrow()
    await page.unroute('**/api/admin/media')
    // Recover the lost upload response by GET, without needing to upload its bytes again.
    const recovered = await page.request.get(`/api/admin/media/commands/${operation}`)
    expect(recovered.status()).toBe(200)
    expect((await recovered.json()).operation).toEqual({ id: operation, status: 'done' })
    expect(row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_media_jobs').n).toBe(1)
    const listing = await (await page.request.get('/api/admin/media?limit=1')).json()
    expect(listing.capacity).toEqual({
      limit: 100,
      consumed: 1,
      remaining: 99,
      includesTombstones: false,
    })
    expect(listing.media).toEqual([
      {
        id,
        state: 'ready',
        revision: operation,
        profiles: ['hero', 'section'],
        integrity: 'not_checked',
      },
    ])
    for (const profile of ['hero', 'section']) {
      const image = await page.request.get(`/api/admin/media/${id}/${profile}`)
      expect(image.status()).toBe(200)
      expect(image.headers()['content-type']).toBe('image/webp')
      expect(image.headers()['cache-control']).toBe('no-store')
      expect(image.headers()['x-content-type-options']).toBe('nosniff')
      expect((await sharp(await image.body()).metadata()).format).toBe('webp')
    }
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

test('E5/E6.0: Página inicial lê o CMS real sem documento e com rascunho v1, sem gravar até confirmar', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  const before = await (await page.request.get('/api/admin/site')).json()
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/site') && request.method() !== 'GET') {
      const action = (request.postDataJSON() as { action?: string } | null)?.action
      // previewConversion só calcula; qualquer outro comando grava
      if (action !== 'previewConversion') writes.push(`${request.method()} ${action}`)
    }
  })
  await page.goto('/admin#pagina-inicial')
  await expect(
    page.getByRole('heading', { name: 'Ainda não há documento da página inicial' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /Iniciar documento/ })).toBeVisible()
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

/** Prepara (só em D1 descartável) um rascunho v1 pelo caminho de escrita legado, como as demais fixtures. */
async function seedV1(page: Page, instance: Integration) {
  const before = await (await page.request.get('/api/admin/site')).json()
  const saved = await page.request.put('/api/admin/site/draft', {
    headers: { Origin: instance.origin, 'If-Match': `"${before.draft.revision}"` },
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
  return v1
}

const convertCommand = (instance: Integration, revision: string, data: object) => ({
  headers: { Origin: instance.origin, 'If-Match': `"${revision}"` },
  data: { expectedRevision: revision, ...data },
})

type SentDocument = { modules: { content: Record<string, unknown> }[] }
/** Registra os comandos de escrita (tudo menos previewConversion) que a página envia. */
function trackCommands(page: Page) {
  const sent: { action: string; operationId: string; document?: SentDocument }[] = []
  page.on('request', (request) => {
    if (!request.url().endsWith('/api/admin/site/convert') || request.method() !== 'POST') return
    const body = request.postDataJSON() as {
      action: string
      operationId: string
      document?: SentDocument
    }
    if (body.action !== 'previewConversion') sent.push(body)
  })
  return sent
}

test('E6.0: iniciar o documento no CMS real só grava ao confirmar e é idempotente', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  const before = await (await page.request.get('/api/admin/site')).json()
  expect(before.schema).toBeNull()
  const sent = trackCommands(page)

  await page.goto('/admin#pagina-inicial')
  await page.getByRole('button', { name: /Iniciar documento/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // aberto o diálogo, ainda nada gravado
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(before)
  expect(sent).toEqual([])

  await page.getByRole('button', { name: 'Criar documento' }).click()
  await expect(
    page.getByText('Documento da página inicial criado. Nada foi publicado.'),
  ).toBeVisible()
  expect(sent).toHaveLength(1)
  expect(sent[0].action).toBe('startV2')

  const after = await (await page.request.get('/api/admin/site')).json()
  expect(after.schema).toBe(2)
  expect(after.published).toBeNull()
  expect(after.draft.document.modules).toHaveLength(9)
  expect(after.draft.document.modules[0].id).toBe('hero')
  expect(after.draft.document.modules.find((m: { id: string }) => m.id === 'catalog')).toBeTruthy()
  expect(
    after.draft.document.modules.find((m: { template: string }) => m.template === 'carousel')
      .content.entries,
  ).toEqual([])
  expect(after.draft.revision).not.toBe(before.draft.revision)

  // segunda inicialização com outra operação: o servidor recusa e nada muda
  const second = await page.request.post('/api/admin/site/convert', {
    ...convertCommand(integration, after.draft.revision, {
      action: 'startV2',
      operationId: crypto.randomUUID(),
      document: after.draft.document,
    }),
  })
  expect(second.status()).toBe(409)
  expect((await second.json()).error.code).toBe('CMS_ALREADY_V2')

  // operação duplicada: o mesmo comando enviado pela tela devolve o mesmo resultado, sem nova revisão
  const replay = await page.request.post('/api/admin/site/convert', {
    ...convertCommand(integration, before.draft.revision, {
      action: 'startV2',
      operationId: sent[0].operationId,
      document: sent[0].document,
    }),
  })
  expect(replay.status()).toBe(200)
  expect((await replay.json()).site.draft.revision).toBe(after.draft.revision)
  // mesmo operationId com dados diferentes é recusado como conflito de operação
  const changedDocument = structuredClone(sent[0].document as SentDocument)
  changedDocument.modules[0].content.heading = 'Outro título'
  const clash = await page.request.post('/api/admin/site/convert', {
    ...convertCommand(integration, before.draft.revision, {
      action: 'startV2',
      operationId: sent[0].operationId,
      document: changedDocument,
    }),
  })
  expect(clash.status()).toBe(409)
  expect((await clash.json()).error.code).toBe('CMS_OPERATION_CONFLICT')
  expect((await (await page.request.get('/api/admin/site')).json()).draft.revision).toBe(
    after.draft.revision,
  )

  // com o documento v2, a tela não oferece mais iniciar nem converter
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Seções da página inicial' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Iniciar documento|Converter/ })).toHaveCount(0)
  expect(sent).toHaveLength(1)
})

test('E6.0: converter o rascunho v1 real mostra a prévia sem gravar e converte só após confirmar', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  const v1 = await seedV1(page, integration)
  const sent = trackCommands(page)

  await page.goto('/admin#pagina-inicial')
  await expect(page.getByText('O que acontece na conversão')).toBeVisible()
  await expect(page.getByRole('button', { name: /Converter para v2/ })).toBeVisible()
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(v1)
  expect(sent).toEqual([])

  await page.getByRole('button', { name: /Converter para v2/ }).click()
  const confirm = page.getByRole('button', { name: 'Converter agora' })
  await expect(confirm).toBeDisabled()
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(v1)
  await page.getByLabel('Entendo que a conversão é definitiva.').check()
  await confirm.click()
  await expect(page.getByText('Documento convertido para o v2. Nada foi publicado.')).toBeVisible()
  expect(sent).toHaveLength(1)
  expect(sent[0].action).toBe('convertToV2')

  const after = await (await page.request.get('/api/admin/site')).json()
  expect(after.schema).toBe(2)
  expect(after.published).toBeNull()
  const converted = after.draft.document.modules as { id: string }[]
  // identificadores do v1 preservados
  const v1Ids = (v1.draft.document.modules as { id: string }[]).map((m) => m.id)
  for (const id of v1Ids) expect(converted.map((m) => m.id)).toContain(id)

  // repetir o mesmo comando já aplicado devolve o resultado original, sem nova revisão
  const replay = await page.request.post('/api/admin/site/convert', {
    ...convertCommand(integration, v1.draft.revision, {
      action: 'convertToV2',
      operationId: sent[0].operationId,
      acknowledge: [],
    }),
  })
  expect(replay.status()).toBe(200)
  expect((await (await page.request.get('/api/admin/site')).json()).draft.revision).toBe(
    after.draft.revision,
  )
})

test('E6.0: revisão alterada entre a prévia e a confirmação vira conflito e nada é convertido', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  const v1 = await seedV1(page, integration)
  const sent = trackCommands(page)
  await page.goto('/admin#pagina-inicial')
  await page.getByRole('button', { name: /Converter para v2/ }).click()
  await page.getByLabel('Entendo que a conversão é definitiva.').check()

  // outra pessoa salva o rascunho depois que a prévia foi aberta
  const edited = cmsDocument()
  edited.modules[0].content = {
    heading: 'Título alterado por outra pessoa',
    summary: '',
    media: null,
  }
  const changed = await page.request.put('/api/admin/site/draft', {
    headers: { Origin: integration.origin, 'If-Match': `"${v1.draft.revision}"` },
    data: {
      action: 'saveDraft',
      expectedRevision: v1.draft.revision,
      operationId: crypto.randomUUID(),
      document: edited,
    },
  })
  expect(changed.status()).toBe(200)
  const current = await (await page.request.get('/api/admin/site')).json()
  expect(current.draft.revision).not.toBe(v1.draft.revision)

  await page.getByRole('button', { name: 'Converter agora' }).click()
  await expect(page.getByRole('alert')).toContainText('O documento mudou')
  expect(sent).toHaveLength(1)
  // o servidor recusou: o rascunho continua v1, exatamente como a outra pessoa o deixou
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(current)
  expect(current.schema).toBe(1)
})

test('E6.0: sessão expirada ao confirmar leva ao login sem gravar', async ({
  page,
  integration,
}) => {
  await login(page, integration)
  const before = await (await page.request.get('/api/admin/site')).json()
  await page.goto('/admin#pagina-inicial')
  await page.getByRole('button', { name: /Iniciar documento/ }).click()
  await page.context().clearCookies()
  await page.getByRole('button', { name: 'Criar documento' }).click()
  await expect(page.getByLabel('Usuário')).toBeVisible()

  await login(page, integration)
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(before)
})

type SiteDoc = {
  commercial: unknown
  modules: { id: string; template: string; visible: boolean; content: Record<string, unknown> }[]
}
const putDraft = (
  page: Page,
  instance: Integration,
  revision: string,
  document: unknown,
  operationId: string = crypto.randomUUID(),
) =>
  page.request.put('/api/admin/site/draft', {
    headers: { Origin: instance.origin, 'If-Match': `"${revision}"` },
    data: { action: 'saveDraft', expectedRevision: revision, operationId, document },
  })

/** Escritas que a tela envia ao CMS, por endpoint (prova de que nada além de saveDraft sai daqui). */
function trackWrites(page: Page) {
  const writes: {
    method: string
    path: string
    body: { operationId?: string; action?: string }
  }[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/admin/site') && request.method() !== 'GET')
      writes.push({
        method: request.method(),
        path: url.pathname,
        body: (request.postDataJSON() ?? {}) as { operationId?: string; action?: string },
      })
  })
  return writes
}

const heroTitle = (page: Page) => page.getByRole('textbox', { name: 'Título' })
const saveDraftButton = (page: Page) => page.getByRole('button', { name: 'Salvar rascunho' })
const savedNotice = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Rascunho salvo. Nada foi publicado.' })

test('E6.1: editar e salvar no CMS real altera só o rascunho e a prévia mostra apenas o salvo', async ({
  page,
  integration,
}) => {
  const seeded = await seedPreview(page, integration)
  const before = seeded.site as { schema: number; draft: { revision: string; document: SiteDoc } }
  const writes = trackWrites(page)

  await page.goto('/admin#pagina-inicial')
  await expect(heroTitle(page)).toHaveValue('Rascunho privado P4')
  await heroTitle(page).fill('Abertura editada no E6')
  // editar não grava: o servidor continua exatamente como estava
  expect((await (await page.request.get('/api/admin/site')).json()).draft).toEqual(before.draft)
  expect(writes).toEqual([])

  await saveDraftButton(page).click()
  await expect(savedNotice(page)).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ method: 'PUT', path: '/api/admin/site/draft' })
  expect(writes[0].body.action).toBe('saveDraft')

  const after = await (await page.request.get('/api/admin/site')).json()
  expect(after.schema).toBe(2)
  expect(after.published).toBeNull()
  expect(after.draft.revision).not.toBe(before.draft.revision)
  const document = after.draft.document as SiteDoc
  expect(document.modules[0].content.heading).toBe('Abertura editada no E6')
  // todo o resto do documento é idêntico: ids, ordem, tipos, visibilidade, mídia e dados comerciais
  expect(document.commercial).toEqual(before.draft.document.commercial)
  expect(document.modules.slice(1)).toEqual(before.draft.document.modules.slice(1))
  expect(document.modules[0].id).toBe(before.draft.document.modules[0].id)

  // repetir o mesmo comando (resposta perdida) devolve o mesmo resultado, sem nova revisão
  const replay = await putDraft(
    page,
    integration,
    before.draft.revision,
    JSON.parse(JSON.stringify(document)),
    writes[0].body.operationId,
  )
  expect(replay.status()).toBe(200)
  expect((await replay.json()).site.draft.revision).toBe(after.draft.revision)
  // o mesmo operationId com outro conteúdo é recusado
  const changed = JSON.parse(JSON.stringify(document)) as SiteDoc
  changed.modules[0].content.heading = 'Outro conteúdo, mesma operação'
  const clash = await putDraft(
    page,
    integration,
    before.draft.revision,
    changed,
    writes[0].body.operationId,
  )
  expect(clash.status()).toBe(409)
  expect((await clash.json()).error.code).toBe('CMS_OPERATION_CONFLICT')
  expect((await (await page.request.get('/api/admin/site')).json()).draft.revision).toBe(
    after.draft.revision,
  )

  // prévia autenticada: mostra o último rascunho salvo, não o que está sendo digitado
  await heroTitle(page).fill('Texto ainda não salvo')
  const preview = await page.context().newPage()
  await preview.goto('/admin/preview')
  const frame = preview.frameLocator('iframe[title="Rascunho CMS v2"]')
  await expect(
    frame.getByRole('heading', { level: 1, name: 'Abertura editada no E6' }),
  ).toBeVisible()
  await expect(frame.getByText('Texto ainda não salvo')).toHaveCount(0)
  await preview.close()
  expect((await (await page.request.get('/api/admin/site')).json()).draft.revision).toBe(
    after.draft.revision,
  )
})

test('E6.1: FAQ, listas e visibilidade salvam no CMS real; obrigatórias e limites são mantidos', async ({
  page,
  integration,
}) => {
  const seeded = await seedPreview(page, integration)
  const before = seeded.site.draft as { revision: string; document: SiteDoc }
  await page.goto('/admin#pagina-inicial')
  const nav = page.getByRole('navigation', { name: 'Seções da página inicial' })

  await nav.getByRole('button', { name: /Perguntas do rascunho/ }).click()
  await page.getByRole('textbox', { name: 'Pergunta 1' }).fill('Qual é o prazo?')
  await page.getByRole('textbox', { name: 'Resposta 1' }).fill('Combinamos no pedido.\nSem pressa.')
  await page.getByRole('button', { name: 'Adicionar item' }).click()
  await page.getByRole('textbox', { name: 'Pergunta 3' }).fill('Tem retirada?')
  await nav.getByRole('button', { name: /História editorial/ }).click()
  await page.getByRole('switch', { name: /Mostrar/ }).click()
  await nav.getByRole('button', { name: /Faixa de destaques/ }).click()
  await page.getByRole('textbox', { name: 'Frase 1' }).fill('Entrega rápida')
  await saveDraftButton(page).click()
  await expect(savedNotice(page)).toBeVisible()

  const after = await (await page.request.get('/api/admin/site')).json()
  const modules = after.draft.document.modules as SiteDoc['modules']
  const faq = modules.find((m) => m.template === 'faq')
  const items = faq?.content.items as { question: string; answer: string }[]
  expect(items[0]).toEqual({
    question: 'Qual é o prazo?',
    answer: 'Combinamos no pedido.\nSem pressa.',
  })
  expect(items[2]).toEqual({ question: 'Tem retirada?', answer: '' })
  expect(modules.find((m) => m.template === 'about')?.visible).toBe(false)
  const ticker = modules.find((m) => m.template === 'ticker')
  expect((ticker?.content.items as string[] | undefined)?.[0]).toBe('Entrega rápida')
  for (const template of ['hero', 'catalog', 'contact'])
    expect(modules.find((m) => m.template === template)?.visible).toBe(true)

  // o servidor real recusa o que a interface já impede (defesa em profundidade); nada é gravado
  const revision = after.draft.revision as string
  const base = JSON.parse(JSON.stringify(after.draft.document)) as SiteDoc
  const attempts: [string, (d: SiteDoc) => void][] = [
    ['título com 121 caracteres', (d) => (d.modules[0].content.heading = 'a'.repeat(121))],
    ['texto com 2001 caracteres', (d) => (d.modules[0].content.summary = 'b'.repeat(2001))],
    ['texto com link', (d) => (d.modules[0].content.summary = 'veja https://exemplo.com')],
    ['seção obrigatória oculta', (d) => (d.modules[0].visible = false)],
    [
      'WhatsApp inválido',
      (d) => ((d.commercial as { whatsappNumber: string }).whatsappNumber = '12'),
    ],
  ]
  for (const [label, mutate] of attempts) {
    const doc = JSON.parse(JSON.stringify(base)) as SiteDoc
    mutate(doc)
    const refused = await putDraft(page, integration, revision, doc)
    expect(refused.status(), label).toBe(400)
  }
  expect((await (await page.request.get('/api/admin/site')).json()).draft.revision).toBe(revision)
  expect(before.revision).not.toBe(revision)
})

test('E6.1: conflito de revisão no CMS real não sobrescreve e preserva o texto local', async ({
  page,
  integration,
}) => {
  const seeded = await seedPreview(page, integration)
  const before = seeded.site.draft as { revision: string; document: SiteDoc }
  const writes = trackWrites(page)
  await page.goto('/admin#pagina-inicial')
  await heroTitle(page).fill('Minha edição')

  // outra sessão salva primeiro
  const other = JSON.parse(JSON.stringify(before.document)) as SiteDoc
  other.modules[0].content.heading = 'Edição da outra sessão'
  expect((await putDraft(page, integration, before.revision, other)).status()).toBe(200)
  const current = await (await page.request.get('/api/admin/site')).json()

  await saveDraftButton(page).click()
  const alert = page.getByRole('alert').filter({ hasText: 'O rascunho mudou em outro lugar' })
  await expect(alert).toContainText('Nada foi gravado')
  expect(writes).toHaveLength(1)
  await expect(heroTitle(page)).toHaveValue('Minha edição')
  await expect(saveDraftButton(page)).toBeDisabled()
  // a versão da outra sessão continua intacta no servidor
  expect(await (await page.request.get('/api/admin/site')).json()).toEqual(current)

  await alert.getByRole('button', { name: 'Carregar versão atual…' }).click()
  await page.getByRole('button', { name: 'Descartar e carregar' }).click()
  await expect(heroTitle(page)).toHaveValue('Edição da outra sessão')
  expect(writes).toHaveLength(1)
})

test('E6.1: sessão expirada ao salvar volta ao login, não grava e restaura o texto depois de entrar', async ({
  page,
  integration,
}) => {
  const seeded = await seedPreview(page, integration)
  const before = seeded.site.draft as { revision: string }
  await page.goto('/admin#pagina-inicial')
  await heroTitle(page).fill('Escrito antes de a sessão cair')
  await page.context().clearCookies()
  await saveDraftButton(page).click()
  await expect(page.getByLabel('Usuário')).toBeVisible()

  await page.getByLabel('Usuário').fill(integration.username)
  await page.getByLabel('Senha', { exact: true }).fill(integration.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByText('Suas alterações foram restauradas depois do login')).toBeVisible()
  await expect(heroTitle(page)).toHaveValue('Escrito antes de a sessão cair')
  // nada foi gravado enquanto a sessão estava expirada
  expect((await (await page.request.get('/api/admin/site')).json()).draft.revision).toBe(
    before.revision,
  )
  await saveDraftButton(page).click()
  await expect(savedNotice(page)).toBeVisible()
  expect(
    (await (await page.request.get('/api/admin/site')).json()).draft.document.modules[0].content
      .heading,
  ).toBe('Escrito antes de a sessão cair')
})

test('E6.1: falha de rede depois de gravar é reconciliada pelo recibo, sem segundo PUT', async ({
  page,
  integration,
}) => {
  await seedPreview(page, integration)
  const writes = trackWrites(page)
  await page.goto('/admin#pagina-inicial')
  await heroTitle(page).fill('Gravou, mas a resposta se perdeu')
  // deixa o servidor real gravar e derruba só a resposta que a página receberia
  await page.route('**/api/admin/site/draft', async (route) => {
    await route.fetch()
    await route.abort('failed')
  })
  await saveDraftButton(page).click()
  await expect(savedNotice(page)).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(
    (await (await page.request.get('/api/admin/site')).json()).draft.document.modules[0].content
      .heading,
  ).toBe('Gravou, mas a resposta se perdeu')
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
  // M2B: a prévia pede cada imagem salva à rota autenticada por ID e perfil. Sem laboratório de mídia
  // o servidor responde 404: hero e "sobre" (MediaFrame) mostram o alerta acessível de indisponibilidade
  // e a entrada do carrossel (MediaImage) cai no espaço reservado, sem quebrar a página.
  await frame.locator('#sobre').scrollIntoViewIfNeeded()
  await expect(
    frame.getByRole('alert').filter({ hasText: 'Esta imagem não está disponível agora' }),
  ).toHaveCount(2)
  await expect(frame.getByRole('img', { name: 'Mídia privada não carregada' })).toHaveCount(1)
  expect(mediaRequests.length).toBeGreaterThan(0)
  for (const url of mediaRequests)
    expect(new URL(url).pathname).toMatch(
      /^\/api\/admin\/media\/media_12345678-1234-4123-8123-123456789012\/(hero|section)$/,
    )
  for (const url of mediaRequests) expect(new URL(url).search).toBe('')
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

// ---------------------------------------------------------------------------------------------
// M2B: biblioteca visual de imagens, em D1 e R2 locais descartáveis (laboratório de mídia)
// ---------------------------------------------------------------------------------------------

type MediaDoc = {
  modules: {
    id: string
    template: string
    content: { media?: { id: string; alt: string } | null }
  }[]
}

async function photo(
  format: 'png' | 'jpeg' | 'webp',
  color = '#c8693f',
  width = 800,
  height = 600,
) {
  const sharp = (await import('sharp')).default
  const base = sharp({ create: { width, height, channels: 3, background: color } })
  return format === 'png'
    ? base.png().toBuffer()
    : format === 'jpeg'
      ? base.jpeg().toBuffer()
      : base.webp().toBuffer()
}
const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer })

/** Envio direto pela API (para montar a biblioteca sem passar pela interface). */
async function apiUpload(page: Page, instance: Integration, buffer: Buffer, mime = 'image/png') {
  const operationId = crypto.randomUUID()
  const response = await page.request.post('/api/admin/media', {
    headers: {
      Origin: instance.origin,
      'Content-Type': mime,
      'X-Operation-Id': operationId,
      'If-None-Match': '*',
    },
    data: buffer,
  })
  return { operationId, id: `media_${operationId}`, status: response.status() }
}

const mediaPicker = (page: Page) => page.getByRole('dialog', { name: 'Escolher imagem' })
const mediaTile = (page: Page, id: string) =>
  mediaPicker(page).getByRole('radio', { name: new RegExp(`Imagem ${id.slice(6, 14)}`) })
const heroSlot = (page: Page) => page.locator('[data-media-slot]')
const altField = (page: Page) => page.getByRole('textbox', { name: 'Texto alternativo da imagem' })
const pickerUse = (page: Page) =>
  mediaPicker(page).getByRole('button', { name: 'Usar esta imagem' })
/** Confirma a escolha e espera a janela terminar de fechar (a página volta a aceitar digitação). */
const confirmImage = async (page: Page) => {
  await pickerUse(page).click()
  await expect(mediaPicker(page)).toBeHidden()
}
const mediaFile = (page: Page) => mediaPicker(page).locator('input[type="file"]')
const uploaded = (page: Page) =>
  mediaPicker(page)
    .locator('[role="status"], [role="alert"]')
    .filter({ hasText: /Imagem [0-9a-f]{8} enviada/ })
const mediaCount = (instance: Integration) =>
  row<{ n: number }>(instance, 'SELECT count(*) n FROM cms_media').n
const draftHero = async (page: Page) => {
  const site = await (await page.request.get('/api/admin/site')).json()
  const doc = site.draft.document as MediaDoc
  return {
    revision: site.draft.revision as string,
    media: doc.modules.find((m) => m.id === 'hero')?.content.media ?? null,
  }
}
async function openMediaPicker(page: Page) {
  await page.getByRole('button', { name: /^(Escolher|Trocar) imagem$/ }).click()
  await expect(mediaPicker(page)).toBeVisible()
}
const injectHeroMedia = (media: { id: string; alt: string }) => async (route: Route) => {
  if (route.request().method() !== 'GET') return route.continue()
  const response = await route.fetch()
  const body = await response.json()
  body.draft.document.modules.find((m: { id: string }) => m.id === 'hero').content.media = media
  return route.fulfill({ response, json: body })
}

test.describe('M2B: biblioteca visual de imagens', () => {
  test.use({ mediaLab: true })

  test('envio, miniatura real, associação, salvamento e prévia com a imagem salva (e só ela)', async ({
    page,
    integration,
  }) => {
    test.setTimeout(120_000)
    await seedPreview(page, integration)
    const writes = trackWrites(page)
    const mediaPosts: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/media')
        mediaPosts.push(request.url())
    })
    await page.goto('/admin#pagina-inicial')
    await expect(heroTitle(page)).toHaveValue('Rascunho privado P4')

    // biblioteca vazia, cota intacta
    await openMediaPicker(page)
    await expect(mediaPicker(page).getByText('Ainda não há imagens na biblioteca.')).toBeVisible()
    await expect(mediaPicker(page).getByText('0 de 100 registros usados').first()).toBeVisible()

    // envio real: bytes de JPEG do projeto, processados em WebP pelo processador local
    const jpeg = await readFile('public/images/kegs/keg-hero-50l.jpg')
    await mediaFile(page).setInputFiles(file('barril.jpg', 'image/jpeg', jpeg))
    await expect(uploaded(page)).toBeVisible({ timeout: 30_000 })
    expect(mediaPosts).toHaveLength(1)
    expect(mediaCount(integration)).toBe(1)
    const stored = row<{ media_id: string; state: string }>(
      integration,
      'SELECT media_id,state FROM cms_media',
    )
    expect(stored.state).toBe('ready')
    const tile = mediaTile(page, stored.media_id)
    await expect(tile).toBeChecked()
    await expect(tile).toBeEnabled()
    await expect(mediaPicker(page).getByText('1 de 100 registros usados').first()).toBeVisible()
    // a miniatura é a imagem entregue de verdade pelo servidor (WebP decodificado no navegador)
    await expect
      .poll(() =>
        mediaPicker(page)
          .locator('img')
          .first()
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0)
    // enviar não grava o documento editorial
    expect(writes).toEqual([])
    expect((await draftHero(page)).media).toBeNull()

    await confirmImage(page)
    await expect(altField(page)).toBeFocused()
    await altField(page).fill('Barril de chopp em aço escovado')
    await expect(heroSlot(page).locator('img')).toBeVisible()
    expect(writes).toEqual([])
    expect((await draftHero(page)).media).toBeNull()

    await saveDraftButton(page).click()
    await expect(savedNotice(page)).toBeVisible()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ method: 'PUT', path: '/api/admin/site/draft' })
    expect((await draftHero(page)).media).toEqual({
      id: stored.media_id,
      alt: 'Barril de chopp em aço escovado',
    })
    expect(
      row<{ published_version_id: string | null }>(
        integration,
        'SELECT published_version_id FROM cms_state',
      ).published_version_id,
    ).toBeNull()

    // segunda imagem: escolhida mas NÃO salva
    const second = await apiUpload(page, integration, await photo('png', '#9db89a'))
    expect(second.status).toBe(200)
    await openMediaPicker(page)
    await expect(mediaPicker(page).getByText('Em uso nesta página')).toHaveCount(1)
    await mediaTile(page, second.id).check()
    await confirmImage(page)
    await expect(altField(page)).toHaveValue('Barril de chopp em aço escovado')

    // a prévia autenticada mostra a imagem SALVA (a primeira), não a escolha local
    const preview = await page.context().newPage()
    await preview.goto('/admin/preview')
    const frame = preview.frameLocator('iframe[title="Rascunho CMS v2"]')
    const image = frame.getByRole('img', { name: 'Barril de chopp em aço escovado' })
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('src', `/api/admin/media/${stored.media_id}/hero`)
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0)
    const html = await frame.locator('body').innerHTML()
    expect(html).not.toContain(second.id)
    expect(html).not.toMatch(/cms\/derived|objectKey|sha256/)
    await preview.close()

    // salvar a segunda troca a imagem; a antiga continua na biblioteca, intacta
    await saveDraftButton(page).click()
    await expect(savedNotice(page)).toBeVisible()
    expect((await draftHero(page)).media?.id).toBe(second.id)
    expect(mediaCount(integration)).toBe(2)
    expect(
      row<{ state: string }>(
        integration,
        'SELECT state FROM cms_media WHERE media_id=?',
        stored.media_id,
      ).state,
    ).toBe('ready')
    const after = await page.context().newPage()
    await after.goto('/admin/preview')
    await expect(
      after
        .frameLocator('iframe[title="Rascunho CMS v2"]')
        .getByRole('img', { name: 'Barril de chopp em aço escovado' }),
    ).toHaveAttribute('src', `/api/admin/media/${second.id}/hero`)
    await after.close()
  })

  test('os três formatos (PNG, JPEG e WebP) são aceitos e processados', async ({
    page,
    integration,
  }) => {
    test.setTimeout(120_000)
    await seedPreview(page, integration)
    await page.goto('/admin#pagina-inicial')
    await openMediaPicker(page)
    const samples = [
      file('a.png', 'image/png', await photo('png', '#c8693f')),
      file('b.jpg', 'image/jpeg', await photo('jpeg', '#8fb3cf')),
      file('c.webp', 'image/webp', await photo('webp', '#9db89a')),
    ]
    for (const [index, sample] of samples.entries()) {
      await mediaFile(page).setInputFiles(sample)
      await expect(
        mediaPicker(page)
          .getByText(`${index + 1} de 100 registros usados`)
          .first(),
      ).toBeVisible({ timeout: 30_000 })
      await expect(uploaded(page)).toBeVisible()
    }
    expect(
      row<{ n: number }>(integration, "SELECT count(*) n FROM cms_media WHERE state='ready'").n,
    ).toBe(3)
    await expect(mediaPicker(page).getByText('Pronta', { exact: true })).toHaveCount(3)
  })

  test('paginação real: 12 por página e a próxima pelo cursor, com a cota consumida', async ({
    page,
    integration,
  }) => {
    test.setTimeout(240_000)
    await seedPreview(page, integration)
    const tiny = await photo('png', '#c8693f', 64, 48)
    for (let i = 0; i < 13; i++) expect((await apiUpload(page, integration, tiny)).status).toBe(200)
    await page.goto('/admin#pagina-inicial')
    await openMediaPicker(page)
    await expect(mediaPicker(page).getByRole('radio')).toHaveCount(12)
    await expect(mediaPicker(page).getByText('13 de 100 registros usados').first()).toBeVisible()
    await expect(mediaPicker(page).getByText('87 envios restantes')).toBeVisible()
    await mediaPicker(page).getByRole('button', { name: 'Carregar mais imagens' }).click()
    await expect(mediaPicker(page).getByRole('radio')).toHaveCount(13)
    await expect(
      mediaPicker(page).getByRole('button', { name: 'Carregar mais imagens' }),
    ).toHaveCount(0)
  })

  test('mídia recusada ou excluída aparece bloqueada e nunca é oferecida como pronta', async ({
    page,
    integration,
  }) => {
    test.setTimeout(120_000)
    await seedPreview(page, integration)
    const good = await apiUpload(page, integration, await photo('png', '#c8693f'))
    const doomed = await apiUpload(page, integration, await photo('png', '#8fb3cf'))
    // o servidor recusa bytes que não são imagem, e a tentativa consome um registro da cota
    const bad = await apiUpload(page, integration, Buffer.from('isto não é uma imagem'))
    expect(bad.status).toBe(400)
    expect(
      row<{ state: string }>(integration, 'SELECT state FROM cms_media WHERE media_id=?', bad.id)
        .state,
    ).toBe('rejected')
    // exclui uma imagem que nada referencia: a exclusão concluída libera a vaga (migration 0010)
    const removed = await page.request.delete(`/api/admin/media/${doomed.id}`, {
      headers: {
        Origin: integration.origin,
        'X-Operation-Id': crypto.randomUUID(),
        'If-Match': `"${doomed.operationId}"`,
      },
    })
    expect(removed.status()).toBe(200)

    await page.goto('/admin#pagina-inicial')
    await openMediaPicker(page)
    await expect(mediaPicker(page).getByText('2 de 100 registros usados').first()).toBeVisible()
    await expect(mediaTile(page, good.id)).toBeEnabled()
    await expect(mediaTile(page, bad.id)).toBeDisabled()
    await expect(mediaTile(page, doomed.id)).toBeDisabled()
    await expect(mediaPicker(page).getByText('Recusada', { exact: true })).toHaveCount(1)
    await expect(mediaPicker(page).getByText('Excluída', { exact: true })).toHaveCount(1)
    await expect(pickerUse(page)).toBeDisabled()
    // a entrega confirma: o servidor não serve o que não está pronto
    expect((await page.request.get(`/api/admin/media/${doomed.id}/section`)).status()).toBe(404)
    expect((await page.request.get(`/api/admin/media/${bad.id}/section`)).status()).toBe(404)
  })

  test('imagem salva que sumiu: o campo avisa e a prévia mostra o espaço reservado, sem quebrar', async ({
    page,
    integration,
  }) => {
    await seedPreview(page, integration)
    const ghost = { id: 'media_12345678-1234-4123-8123-123456789012', alt: 'Imagem fantasma' }
    await page.route('**/api/admin/site', injectHeroMedia(ghost))
    await page.goto('/admin#pagina-inicial')
    await expect(heroSlot(page)).toBeVisible()
    await expect(heroSlot(page).getByRole('alert')).toContainText(
      'Esta imagem não está disponível agora',
    )
    await expect(altField(page)).toHaveValue('Imagem fantasma')
    const preview = await page.context().newPage()
    await preview.route('**/api/admin/site', injectHeroMedia(ghost))
    await preview.goto('/admin/preview')
    const frame = preview.frameLocator('iframe[title="Rascunho CMS v2"]')
    await expect(
      frame.getByRole('heading', { level: 1, name: 'Rascunho privado P4' }),
    ).toBeVisible()
    // Hero usa MediaFrame: o 404 vira o alerta acessível de indisponibilidade (não um placeholder).
    await expect(
      frame.getByRole('alert').filter({ hasText: 'Esta imagem não está disponível agora' }),
    ).toHaveCount(1)
    await preview.close()
  })

  test('conflito de revisão: a associação não sobrescreve a versão nova e permanece local', async ({
    page,
    integration,
  }) => {
    test.setTimeout(120_000)
    const seeded = await seedPreview(page, integration)
    const before = seeded.site.draft as { revision: string; document: SiteDoc }
    const image = await apiUpload(page, integration, await photo('png'))
    const writes = trackWrites(page)
    await page.goto('/admin#pagina-inicial')
    await openMediaPicker(page)
    await mediaTile(page, image.id).check()
    await confirmImage(page)
    await altField(page).fill('Minha imagem')

    // outra sessão salva primeiro
    const other = JSON.parse(JSON.stringify(before.document)) as SiteDoc
    other.modules[0].content.heading = 'Edição da outra sessão'
    expect((await putDraft(page, integration, before.revision, other)).status()).toBe(200)
    const current = await (await page.request.get('/api/admin/site')).json()

    await saveDraftButton(page).click()
    const alert = page.getByRole('alert').filter({ hasText: 'O rascunho mudou em outro lugar' })
    await expect(alert).toContainText('Nada foi gravado')
    expect(writes).toHaveLength(1)
    await expect(altField(page)).toHaveValue('Minha imagem')
    await expect(saveDraftButton(page)).toBeDisabled()
    // a versão da outra sessão continua intacta, sem a imagem
    expect(await (await page.request.get('/api/admin/site')).json()).toEqual(current)
    expect((await draftHero(page)).media).toBeNull()
  })

  test('sessão expirada ao abrir a biblioteca e durante o envio: nada é gravado e as edições voltam', async ({
    page,
    integration,
  }) => {
    test.setTimeout(120_000)
    await seedPreview(page, integration)
    await page.goto('/admin#pagina-inicial')
    await expect(heroTitle(page)).toHaveValue('Rascunho privado P4')
    await heroTitle(page).fill('Escrito antes de a sessão cair')
    await page.context().clearCookies()
    await page.getByRole('button', { name: /^(Escolher|Trocar) imagem$/ }).click()
    await expect(page.getByLabel('Usuário')).toBeVisible()
    await page.getByLabel('Usuário').fill(integration.username)
    await page.getByLabel('Senha', { exact: true }).fill(integration.password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByText('Suas alterações foram restauradas depois do login')).toBeVisible()
    await expect(heroTitle(page)).toHaveValue('Escrito antes de a sessão cair')

    // agora a sessão cai com a janela aberta, no meio de um envio
    await openMediaPicker(page)
    await expect(mediaPicker(page).getByText('0 de 100 registros usados').first()).toBeVisible()
    await page.context().clearCookies()
    await mediaFile(page).setInputFiles(file('x.png', 'image/png', await photo('png')))
    await expect(page.getByLabel('Usuário')).toBeVisible()
    expect(mediaCount(integration)).toBe(0)
    expect(row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_media_jobs').n).toBe(0)
    await page.getByLabel('Usuário').fill(integration.username)
    await page.getByLabel('Senha', { exact: true }).fill(integration.password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(heroTitle(page)).toHaveValue('Escrito antes de a sessão cair')
    expect((await draftHero(page)).media).toBeNull()
  })

  test('resposta de envio perdida: o recibo confirma e há um único envio e um único registro', async ({
    page,
    integration,
  }) => {
    test.setTimeout(120_000)
    await seedPreview(page, integration)
    let posts = 0
    await page.route('**/api/admin/media', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      posts++
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('failed')
    })
    await page.goto('/admin#pagina-inicial')
    await openMediaPicker(page)
    await mediaFile(page).setInputFiles(file('perdida.png', 'image/png', await photo('png')))
    await expect(uploaded(page)).toBeVisible({ timeout: 30_000 })
    expect(posts).toBe(1)
    await page.waitForTimeout(500)
    expect(posts).toBe(1)
    expect(row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_media_jobs').n).toBe(1)
    expect(mediaCount(integration)).toBe(1)
    await expect(mediaPicker(page).getByText('1 de 100 registros usados').first()).toBeVisible()
  })

  test('a homepage pública segue independente: sem requisições de mídia, catálogo e rotas públicas intactos', async ({
    page,
    integration,
    browser,
  }) => {
    test.setTimeout(120_000)
    await seedPreview(page, integration)
    const before = await (await page.request.get('/api/catalog')).json()
    const image = await apiUpload(page, integration, await photo('png'))
    await page.goto('/admin#pagina-inicial')
    await openMediaPicker(page)
    await mediaTile(page, image.id).check()
    await confirmImage(page)
    await altField(page).fill('Imagem salva no rascunho')
    await saveDraftButton(page).click()
    await expect(savedNotice(page)).toBeVisible()

    const visitor = await browser.newContext({ baseURL: integration.origin })
    try {
      const publicPage = await visitor.newPage()
      const requested: string[] = []
      publicPage.on('request', (request) => requested.push(new URL(request.url()).pathname))
      await publicPage.goto('/')
      await expect(publicPage.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await publicPage.waitForLoadState('networkidle')
      expect(requested.filter((path) => path.startsWith('/api/admin'))).toEqual([])
      expect(await publicPage.content()).not.toContain(image.id)
      // as imagens são privadas: sem sessão, nada é entregue
      for (const path of [
        `/api/admin/media/${image.id}/hero`,
        `/api/admin/media/${image.id}/section`,
        '/api/admin/media',
        `/api/media/${image.id}`,
      ]) {
        const status = (await visitor.request.get(path)).status()
        expect([401, 404], path).toContain(status)
      }
    } finally {
      await visitor.close()
    }
    expect(await (await page.request.get('/api/catalog')).json()).toEqual(before)
    expect(
      row<{ published_version_id: string | null }>(
        integration,
        'SELECT published_version_id FROM cms_state',
      ).published_version_id,
    ).toBeNull()
    for (const path of ['/api/site', '/api/cms', '/api/admin/site/publish'])
      expect([404, 405], path).toContain((await page.request.get(path)).status())
  })
})

test('M2B: sem laboratório de mídia (ambiente normal) a biblioteca explica e o texto segue editável', async ({
  page,
  integration,
}) => {
  test.setTimeout(120_000)
  await seedPreview(page, integration)
  await page.goto('/admin#pagina-inicial')
  await expect(heroTitle(page)).toHaveValue('Rascunho privado P4')
  await page.getByRole('button', { name: /^(Escolher|Trocar) imagem$/ }).click()
  await expect(
    mediaPicker(page)
      .getByRole('alert')
      .filter({ hasText: 'A biblioteca de imagens não está disponível aqui' }),
  ).toBeVisible()
  await expect(mediaPicker(page).getByRole('button', { name: 'Escolher arquivo…' })).toHaveCount(0)
  await mediaPicker(page).getByRole('button', { name: 'Cancelar' }).click()
  await expect(mediaPicker(page)).toBeHidden()
  await heroTitle(page).fill('Texto continua editável')
  await saveDraftButton(page).click()
  await expect(savedNotice(page)).toBeVisible()
  expect(row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_media').n).toBe(0)
})

test.describe('Publicação do CMS: rascunho → publicar → /api/site → vitrine', () => {
  // Harness descartável: D1 e R2 locais, processador local de imagens e vitrine em modo release.
  const COMMERCIAL = '5531984400001'
  test.use({ mediaLab: true, runtimeMode: 'release', whatsappNumber: COMMERCIAL })

  type Head = { revision: string; document: ReturnType<typeof previewFixture> }
  const adminSite = async (page: Page) =>
    (await page.request.get('/api/admin/site')).json() as Promise<{
      draft: Head
      published: { versionId: string; revision: string } | null
    }>
  const write = (
    page: Page,
    instance: Integration,
    action: 'saveDraft' | 'publish',
    revision: string,
    document: unknown,
    operationId = crypto.randomUUID(),
  ) =>
    page.request.fetch(`/api/admin/site/${action === 'publish' ? 'publish' : 'draft'}`, {
      method: action === 'publish' ? 'POST' : 'PUT',
      headers: { Origin: instance.origin, 'If-Match': `"${revision}"` },
      data: { action, operationId, expectedRevision: revision, document },
    })
  const publishable = (mediaId: string, heading: string) => {
    const document = previewFixture()
    document.commercial.whatsappNumber = COMMERCIAL
    for (const module of document.modules)
      if (module.template === 'hero')
        module.content = {
          heading,
          summary: 'Resumo editorial publicado',
          media: { id: mediaId, alt: 'Barril de chopp gelado' },
          deliveryRegion: 'São João del-Rei',
        }
    return document
  }
  async function uploadImage(page: Page, instance: Integration) {
    const sharp = (await import('sharp')).default
    const bytes = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#803020' },
    })
      .png()
      .toBuffer()
    const operation = crypto.randomUUID()
    const response = await page.request.post('/api/admin/media', {
      headers: {
        Origin: instance.origin,
        'Content-Type': 'image/png',
        'X-Operation-Id': operation,
        'If-None-Match': '*',
      },
      data: bytes,
    })
    expect(response.status()).toBe(200)
    return `media_${operation}`
  }
  const published = (instance: Integration) =>
    row<{ published_version_id: string | null; published_revision: string | null }>(
      instance,
      'SELECT published_version_id,published_revision FROM cms_v2_state',
    )

  test('publicação completa, controles negativos, isolamento do rascunho e dados comerciais intactos', async ({
    page,
    integration,
    browser,
  }) => {
    test.setTimeout(180_000)
    await seedPreview(page, integration)
    const commercialBefore = await catalogState(integration)
    const productsBefore = await (await page.request.get('/api/products')).json()
    const catalogBefore = await (await page.request.get('/api/catalog')).json()
    const anonymous = await browser.newContext({ baseURL: integration.origin })
    const shop = await anonymous.newPage()
    const state = (expected: string) =>
      expect(shop.locator('[data-editorial-state]')).toHaveAttribute(
        'data-editorial-state',
        expected,
        { timeout: 20_000 },
      )
    try {
      // 0. Nada publicado: /api/site é 404 CMS_NOT_PUBLISHED e a vitrine usa a apresentação padrão.
      const none = await anonymous.request.get('/api/site')
      expect(none.status()).toBe(404)
      expect((await none.json()).error.code).toBe('CMS_NOT_PUBLISHED')
      await shop.goto('/')
      await state('absent')

      // 1. Publicação incompleta (sem WhatsApp nem imagem): o rascunho salva, mas publicar é recusado.
      let head = (await adminSite(page)).draft
      const incomplete = await write(page, integration, 'saveDraft', head.revision, head.document)
      expect(incomplete.status()).toBe(200)
      head = (await adminSite(page)).draft
      const refused = await write(page, integration, 'publish', head.revision, head.document)
      expect(refused.status()).toBe(400)
      expect(published(integration)).toEqual({
        published_version_id: null,
        published_revision: null,
      })

      // 2. Imagem inexistente: nem o rascunho aceita referência de mídia que a biblioteca não tem.
      const ghost = publishable(`media_${crypto.randomUUID()}`, 'Título fantasma')
      const ghostSave = await write(page, integration, 'saveDraft', head.revision, ghost)
      expect(ghostSave.status()).toBe(400)

      // 3. Rascunho completo e salvo; ainda assim NADA aparece na vitrine antes de publicar.
      const mediaId = await uploadImage(page, integration)
      const first = publishable(mediaId, 'Título publicado E2E')
      const oldRevision = head.revision
      const saved = await write(page, integration, 'saveDraft', head.revision, first)
      expect(saved.status()).toBe(200)
      head = (await adminSite(page)).draft
      expect((await anonymous.request.get('/api/site')).status()).toBe(404)
      expect((await anonymous.request.get(`/api/site/media/${mediaId}/hero`)).status()).toBe(404)
      await shop.reload()
      await state('absent')
      await expect(shop.getByText('Título publicado E2E')).toHaveCount(0)

      // 4. Revisão desatualizada e documento diferente do rascunho salvo: 409 e nada publicado.
      const stale = await write(page, integration, 'publish', oldRevision, first)
      expect(stale.status()).toBe(409)
      const other = publishable(mediaId, 'Texto que não é o rascunho salvo')
      expect((await write(page, integration, 'publish', head.revision, other)).status()).toBe(409)
      expect(published(integration).published_version_id).toBeNull()

      // 5. Imagem pronta e referenciada pelo rascunho não pode deixar de estar pronta: o próprio SQL
      // recusa a adulteração (a reconferência no instante de publicar está em cms-publication.test.ts).
      for (const sql of [
        'UPDATE cms_media SET derivatives_json=NULL WHERE media_id=?',
        "UPDATE cms_media SET state='rejected' WHERE media_id=?",
        "UPDATE cms_media SET state='deleting' WHERE media_id=?",
      ])
        expect(() => integration.database.prepare(sql).run(mediaId)).toThrow()
      expect(
        row<{ state: string }>(integration, 'SELECT state FROM cms_media WHERE media_id=?', mediaId)
          .state,
      ).toBe('ready')

      // 6. Publicação válida: sessão autenticada, origem, If-Match e documento idêntico ao rascunho.
      const operationId = crypto.randomUUID()
      const ok = await write(page, integration, 'publish', head.revision, first, operationId)
      expect(ok.status()).toBe(200)
      const receipt = (await ok.json()) as { command: { revision: string; versionId: string } }
      expect(published(integration).published_version_id).toBe(receipt.command.versionId)
      const versions = row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_v2_versions').n
      // Replay do mesmo comando: mesmo recibo, nenhuma versão nova.
      const replay = await write(page, integration, 'publish', head.revision, first, operationId)
      expect(replay.status()).toBe(200)
      expect(((await replay.json()) as typeof receipt).command.versionId).toBe(
        receipt.command.versionId,
      )
      expect(row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_v2_versions').n).toBe(
        versions,
      )

      // 7. /api/site anônimo mostra só a projeção publicada; a vitrine e a mídia pública a seguem.
      const site = await anonymous.request.get('/api/site')
      expect(site.status()).toBe(200)
      const body = await site.json()
      expect(body.commercial).toEqual({ fulfillmentMode: 'delivery', whatsappNumber: COMMERCIAL })
      expect(JSON.stringify(body)).toContain('Título publicado E2E')
      expect(JSON.stringify(body)).not.toMatch(/operationId|actor|session|objectKey|sha256/)
      const image = await anonymous.request.get(`/api/site/media/${mediaId}/hero`)
      expect(image.status()).toBe(200)
      expect(image.headers()['content-type']).toBe('image/webp')
      await shop.reload()
      await state('ready')
      await expect(shop.getByText('Título publicado E2E').first()).toBeVisible()
      const whatsapp = shop.locator('a[href^="https://wa.me/"]').first()
      await expect(whatsapp).toHaveAttribute('href', new RegExp(`^https://wa\\.me/${COMMERCIAL}`))

      // 8. Rascunho posterior não publicado: o site continua na versão publicada.
      head = (await adminSite(page)).draft
      const edited = publishable(mediaId, 'Rascunho posterior não publicado')
      expect((await write(page, integration, 'saveDraft', head.revision, edited)).status()).toBe(
        200,
      )
      const still = JSON.stringify(await (await anonymous.request.get('/api/site')).json())
      expect(still).toContain('Título publicado E2E')
      expect(still).not.toContain('Rascunho posterior não publicado')
      await shop.reload()
      await state('ready')
      await expect(shop.getByText('Rascunho posterior não publicado')).toHaveCount(0)

      // 9. Recuperação: publicar o conteúdo anterior como nova versão preserva o histórico imutável.
      head = (await adminSite(page)).draft
      expect((await write(page, integration, 'publish', head.revision, edited)).status()).toBe(200)
      head = (await adminSite(page)).draft
      expect((await write(page, integration, 'saveDraft', head.revision, first)).status()).toBe(200)
      head = (await adminSite(page)).draft
      expect((await write(page, integration, 'publish', head.revision, first)).status()).toBe(200)
      expect(JSON.stringify(await (await anonymous.request.get('/api/site')).json())).toContain(
        'Título publicado E2E',
      )
      expect(
        row<{ n: number }>(
          integration,
          "SELECT count(*) n FROM cms_v2_versions WHERE kind='published'",
        ).n,
      ).toBe(3)

      // 10. Dados comerciais intactos: catálogo, preços, variantes e disponibilidade.
      expect(await catalogState(integration)).toEqual(commercialBefore)
      expect(await (await page.request.get('/api/products')).json()).toEqual(productsBefore)
      expect(await (await page.request.get('/api/catalog')).json()).toEqual(catalogBefore)
    } finally {
      await anonymous.close()
    }
  })

  test('clique em Publicar na interface: WhatsApp, salvar, confirmar e publicar uma única vez', async ({
    page,
    integration,
    browser,
  }) => {
    test.setTimeout(180_000)
    await seedPreview(page, integration)
    const mediaId = await uploadImage(page, integration)
    // Rascunho completo (imagem pronta e barris), mas sem WhatsApp: é o estado real da homologação.
    const document = publishable(mediaId, 'Publicado pelo clique E2E')
    document.commercial.whatsappNumber = null
    const head = (await adminSite(page)).draft
    expect((await write(page, integration, 'saveDraft', head.revision, document)).status()).toBe(
      200,
    )
    const publishCalls: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/admin/site/publish'))
        publishCalls.push(request.url())
    })
    await page.goto('/admin#pagina-inicial')
    const publish = page.getByRole('button', { name: 'Publicar', exact: true })

    // 1. Sem WhatsApp definido: bloqueado, com a explicação, e nada é enviado.
    await expect(publish).toBeDisabled()
    await expect(
      page.getByText('Para publicar: O WhatsApp comercial do documento ainda não foi definido.'),
    ).toBeVisible()

    // 2. O WhatsApp vem do número comercial do build: alteração não salva ainda bloqueia publicar.
    await page.getByRole('button', { name: 'Usar o WhatsApp comercial do site' }).click()
    await expect(publish).toBeDisabled()
    await expect(page.getByText('Salve o rascunho antes de publicar.')).toBeVisible()

    // 3. Salvar não publica.
    await saveDraftButton(page).click()
    await expect(savedNotice(page)).toBeVisible()
    await expect(publish).toBeEnabled()
    expect(publishCalls).toHaveLength(0)
    expect(published(integration).published_version_id).toBeNull()

    // 4. Publicar exige confirmação; clique duplo na confirmação gera uma única publicação.
    await publish.click()
    const dialog = page.getByRole('dialog', { name: 'Publicar na vitrine?' })
    await expect(dialog).toContainText(COMMERCIAL)
    await dialog.getByRole('button', { name: 'Publicar', exact: true }).dblclick()
    await expect(page.getByText('Publicado. A vitrine passa a usar este conteúdo.')).toBeVisible()
    expect(publishCalls).toHaveLength(1)
    expect(published(integration).published_version_id).not.toBeNull()

    // 5. O site público passa a servir o conteúdo publicado, com o WhatsApp comercial.
    const anonymous = await browser.newContext({ baseURL: integration.origin })
    try {
      const site = await anonymous.request.get('/api/site')
      expect(site.status()).toBe(200)
      const body = await site.json()
      expect(body.commercial.whatsappNumber).toBe(COMMERCIAL)
      expect(JSON.stringify(body)).toContain('Publicado pelo clique E2E')
    } finally {
      await anonymous.close()
    }
  })

  test('FAQ publicado pelo CMS: nasce fechado, nunca rola e não acumula deslocamento (1440 e 390)', async ({
    page,
    integration,
    browser,
  }) => {
    test.setTimeout(180_000)
    await seedPreview(page, integration)
    const mediaId = await uploadImage(page, integration)
    const publishedDoc = publishable(mediaId, 'FAQ publicado E2E')
    let head = (await adminSite(page)).draft
    expect(
      (await write(page, integration, 'saveDraft', head.revision, publishedDoc)).status(),
    ).toBe(200)
    head = (await adminSite(page)).draft
    expect((await write(page, integration, 'publish', head.revision, head.document)).status()).toBe(
      200,
    )

    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      const context = await browser.newContext({
        baseURL: integration.origin,
        viewport: { width, height },
      })
      const shop = await context.newPage()
      try {
        await shop.goto('/')
        await expect(shop.locator('[data-editorial-state]')).toHaveAttribute(
          'data-editorial-state',
          'ready',
          { timeout: 20_000 },
        )
        const faq = shop.locator('#faq button[aria-expanded]')
        await expect(faq.first()).toHaveAttribute('aria-expanded', 'false')
        await shop.evaluate((height) => {
          const list = document
            .querySelector('#faq button[aria-expanded]')
            ?.closest('div')?.parentElement
          if (!list) throw new Error('lista do FAQ ausente')
          const top = list.getBoundingClientRect().top + window.scrollY
          window.scrollTo({ top: top - height * 0.2, behavior: 'instant' })
        }, height)
        await shop.waitForTimeout(400)
        const click = (index: number) =>
          faq.nth(index).evaluate((node) => (node as HTMLButtonElement).click())
        const scrollY = () => shop.evaluate(() => window.scrollY)
        // Nasce fechado: abrir a 1ª pergunta não rola a página.
        const scrollBefore = await scrollY()
        await click(0)
        await expect(faq.first()).toHaveAttribute('aria-expanded', 'true')
        expect(Math.abs((await scrollY()) - scrollBefore), `${width}px abrir 1ª`).toBeLessThan(1.5)
        const firstTop = await faq.first().evaluate((node) => node.getBoundingClientRect().top)
        // Dez ciclos entre a 1ª e a 2ª pergunta: o componente nunca rola a página e nada se acumula.
        for (let cycle = 1; cycle <= 10; cycle++) {
          await click(1)
          await expect(faq.nth(1)).toHaveAttribute('aria-expanded', 'true')
          await expect(faq.first()).toHaveAttribute('aria-expanded', 'false')
          expect(
            Math.abs((await scrollY()) - scrollBefore),
            `${width}px ciclo ${cycle}: ida`,
          ).toBeLessThan(1.5)
          await click(0)
          await expect(faq.first()).toHaveAttribute('aria-expanded', 'true')
          expect(
            Math.abs((await scrollY()) - scrollBefore),
            `${width}px ciclo ${cycle}: volta`,
          ).toBeLessThan(1.5)
          const first = await faq.first().evaluate((node) => node.getBoundingClientRect().top)
          expect(Math.abs(first - firstTop), `${width}px ciclo ${cycle}: 1ª`).toBeLessThan(1.5)
        }
      } finally {
        await context.close()
      }
    }
  })
})

/**
 * F4A.5.4: validação integrada do catálogo, de ponta a ponta e sem mocks: build `release`, gateway
 * HTTP real, sessão administrativa real, D1 local descartável e número de WhatsApp fictício.
 */
test.describe('F4A.5.4: catálogo integrado (admin real → API → D1 → vitrine)', () => {
  for (const viewport of [
    { name: 'desktop 1440', width: 1440, height: 900 },
    { name: 'mobile 390', width: 390, height: 844 },
  ]) {
    test.describe(viewport.name, () => {
      test.use({
        runtimeMode: 'release',
        whatsappNumber: '5500000000000',
        viewport: { width: viewport.width, height: viewport.height },
      })

      test('cria, ajusta, publica, oculta, recusa duplicata e preserva dados em conflito', async ({
        page,
        browser,
        integration,
      }) => {
        test.setTimeout(180_000)
        const origin = integration.origin
        const sql = (text: string, ...values: (string | number | null)[]) =>
          integration.database.prepare(text).all(...values)
        const originals = () => ({
          items: sql(
            "SELECT id, category_id, name, description, visible, sort_order FROM catalog_items WHERE id NOT LIKE 'item_%' ORDER BY id",
          ),
          variants: sql(
            "SELECT item_id, code, label, volume_ml, price_cents, sort_order FROM catalog_variants WHERE item_id NOT LIKE 'item_%' AND code IN ('30','50','bottle') ORDER BY item_id, code",
          ),
        })
        const initial = originals()
        expect(initial.items).toHaveLength(9)
        type Snapshot = {
          revision: string
          categories: {
            id: string
            name: string
            items: {
              id: string
              name: string
              visible: boolean
              variants: {
                code: string
                label: string
                volumeMl: number
                priceCents: number | null
              }[]
            }[]
          }[]
        }
        const apiSnapshot = async () => (await (await page.request.get(path)).json()) as Snapshot
        const writable = (snapshot: Snapshot) => ({
          revision: snapshot.revision,
          categories: snapshot.categories.map((c) => ({
            ...c,
            items: c.items.map((item) => {
              const {
                creationRef: _r,
                variants,
                ...rest
              } = item as typeof item & {
                creationRef?: unknown
              }
              return {
                ...rest,
                variants: variants.map((variant) => {
                  const { creationRef: _v, ...clean } = variant as typeof variant & {
                    creationRef?: unknown
                  }
                  return clean as Record<string, unknown>
                }),
              }
            }),
          })),
        })
        const itemCard = (name: string) => page.getByRole('listitem', { name, exact: true })

        // 1. Autenticação real; uma segunda sessão carrega o catálogo antigo para o conflito (11).
        await login(page, integration)
        const secondContext = await browser.newContext({
          baseURL: origin,
          viewport: { width: viewport.width, height: viewport.height },
        })
        const other = await secondContext.newPage()
        await login(other, integration)
        const firstRevision = (await apiSnapshot()).revision

        // 2-3. Produto novo com 20 L e 40 L, visível; salva pelo painel e confere API e D1.
        const created = await add(page, 'Chopes', 'Chope Vinte Quarenta', '20', '25000')
        await created.getByLabel('Rótulo', { exact: true }).first().fill('Barril de 20 L')
        await created.getByRole('button', { name: 'Adicionar variante' }).click()
        await created.getByLabel('Rótulo', { exact: true }).last().fill('Barril de 40 L')
        await created.getByLabel('Volume (L)', { exact: true }).last().fill('40')
        await created
          .getByLabel(/^Preço em reais/)
          .last()
          .fill('45000')
        await created.getByRole('switch').check()
        const putCreate = page.waitForResponse(
          (r) => r.url().endsWith(path) && r.request().method() === 'PUT',
        )
        await saved(page)
        expect((await putCreate).status()).toBe(200)
        const apiItem = (await apiSnapshot()).categories[0].items.find(
          (i) => i.name === 'Chope Vinte Quarenta',
        )
        expect(apiItem?.visible).toBe(true)
        expect(apiItem?.variants.map((v) => [v.label, v.volumeMl, v.priceCents])).toEqual([
          ['Barril de 20 L', 20000, 25000],
          ['Barril de 40 L', 40000, 45000],
        ])
        const newId = apiItem?.id as string
        expect(newId).toMatch(/^item_/)
        expect(
          sql(
            'SELECT label, volume_ml, price_cents FROM catalog_variants WHERE item_id=? ORDER BY sort_order',
            newId,
          ),
        ).toEqual([
          { label: 'Barril de 20 L', volume_ml: 20000, price_cents: 25000 },
          { label: 'Barril de 40 L', volume_ml: 40000, price_cents: 45000 },
        ])

        // 4. Recarrega o painel: os dados persistidos voltam do servidor.
        await page.reload()
        const reloaded = itemCard('Chope Vinte Quarenta')
        await expect(reloaded.getByLabel('Nome', { exact: true })).toHaveValue(
          'Chope Vinte Quarenta',
        )
        await expect(reloaded.getByText('Barril de 20 L')).toBeVisible()
        await expect(reloaded.getByText('Barril de 40 L')).toBeVisible()
        await expect(reloaded.getByLabel(/^Preço em reais/).last()).toHaveValue('450,00')

        // 5. Variante de 20 L num produto existente de 30/50 L.
        await page.getByRole('button', { name: 'Adicionar variante a Dronken' }).click()
        const dronken = itemCard('Dronken')
        await dronken.getByLabel('Rótulo', { exact: true }).fill('Barril de 20 L')
        await dronken.getByLabel('Volume (L)', { exact: true }).fill('20')
        await dronken
          .getByLabel(/^Preço em reais/)
          .last()
          .fill('30000')
        await saved(page)
        expect(
          sql(
            'SELECT code FROM catalog_variants WHERE item_id=? ORDER BY sort_order',
            'dronken',
          ).map((v) => (v as { code: string }).code.replace(/^v_.*/, 'v_')),
        ).toEqual(['30', '50', 'v_'])

        // 6-8. Vitrine pública real (contexto sem sessão): tabela original, complementar e WhatsApp.
        const shopContext = await browser.newContext({
          baseURL: origin,
          viewport: { width: viewport.width, height: viewport.height },
        })
        const shop = await shopContext.newPage()
        const message = async (link: Locator) =>
          ((await whatsappMessage(link)) ?? '').replaceAll(' ', ' ')
        try {
          await shop.goto('/')
          const section = shop.locator('#chopes')
          await expect(section.locator('table tbody tr')).toHaveCount(8) // tabela original, só 30/50 L
          await expect(section.getByRole('row', { name: /Dronken/ })).toContainText('R$ 510')
          await expect(section.getByRole('row', { name: /Dronken/ })).toContainText('R$ 650')
          const extras = section.getByRole('article')
          await expect(extras).toHaveCount(2) // Dronken (20 L adicional) e o produto novo
          const extraDronken = extras.filter({ hasText: 'Dronken' })
          await expect(extraDronken).toContainText('Outras apresentações')
          await expect(extraDronken).toContainText('Barril de 20 L')
          await expect(extraDronken).toContainText('R$ 300,00')
          const fresh = extras.filter({ hasText: 'Chope Vinte Quarenta' })
          await expect(fresh).not.toContainText('Outras apresentações')
          await expect(fresh).toContainText('R$ 250,00')
          await expect(fresh).toContainText('R$ 450,00')
          const publicData = (await (await shop.request.get('/api/catalog')).json()) as {
            categories: { items: { id: string; variants: { priceCents: number }[] }[] }[]
          }
          expect(
            publicData.categories[0].items
              .find((i) => i.id === newId)
              ?.variants.map((v) => v.priceCents),
          ).toEqual([25000, 45000])

          // WhatsApp: produto, variante, quantidade, preço e total, só lendo o href.
          const more = section.getByRole('button', {
            name: 'Aumentar quantidade de Chope Vinte Quarenta, Barril de 20 L',
          })
          await more.click()
          await more.click()
          const link = section.getByRole('link', {
            name: /^Pedir Chope Vinte Quarenta, Barril de 20 L/,
          })
          const url = new URL((await link.getAttribute('href')) as string)
          expect(`${url.origin}${url.pathname}`).toBe('https://wa.me/5500000000000')
          expect(await message(link)).toBe(
            'Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de Chope Vinte Quarenta (Barril de 20 L). Quantidade: 3 unidades. Preço unitário: R$ 250. Total: R$ 750.',
          )
          expect(
            await message(section.getByRole('link', { name: /^Pedir Dronken, Barril de 20 L/ })),
          ).toContain(
            'barril de Dronken (Barril de 20 L). Quantidade: 1 unidade. Preço unitário: R$ 300. Total: R$ 300.',
          )
          expect(
            await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true)

          // 9. Ocultar o produto novo: some da vitrine e da API pública, continua no admin.
          await itemCard('Chope Vinte Quarenta').getByRole('switch').uncheck()
          await saved(page)
          await shop.reload()
          await expect(shop.locator('#chopes')).not.toContainText('Chope Vinte Quarenta')
          await expect(shop.locator('#barris')).not.toContainText('Chope Vinte Quarenta')
          const hiddenPublic = (await (await shop.request.get('/api/catalog')).json()) as {
            categories: { items: { id: string }[] }[]
          }
          expect(hiddenPublic.categories[0].items.some((i) => i.id === newId)).toBe(false)
          expect(
            (await apiSnapshot()).categories[0].items.find((i) => i.id === newId)?.visible,
          ).toBe(false)
        } finally {
          await shopContext.close()
        }

        // 10. Duplicata exata: o painel avisa sem enviar nada; o servidor também recusa, sem escrita parcial.
        let puts = 0
        page.on('request', (r) => {
          if (r.url().endsWith(path) && r.method() === 'PUT') puts++
        })
        await dronken.getByRole('button', { name: 'Adicionar variante' }).click()
        await dronken.getByLabel('Rótulo', { exact: true }).last().fill(' barril de 20 l ')
        await dronken.getByLabel('Volume (L)', { exact: true }).last().fill('20')
        await dronken
          .getByLabel(/^Preço em reais/)
          .last()
          .fill('100')
        await save(page).click()
        await expect(
          dronken.getByText('Já existe uma variante com este rótulo e volume neste produto.'),
        ).toBeVisible()
        expect(puts).toBe(0)
        const before = await catalogState(integration)
        const current = await apiSnapshot()
        const body = writable(current)
        body.categories[0].items
          .find((i) => i.id === 'dronken')
          ?.variants.push({
            clientId: `tmp:${crypto.randomUUID()}`,
            label: ' barril DE 20 l ',
            volumeMl: 20000,
            priceCents: 100,
          })
        const duplicate = await page.request.put(path, {
          data: body,
          headers: { Origin: origin, 'If-Match': JSON.stringify(current.revision) },
        })
        expect(duplicate.status()).toBe(400)
        expect(JSON.stringify(await duplicate.json())).toContain('rótulo e volume')
        expect(await catalogState(integration)).toEqual(before)

        // 11. Conflito: revisão antiga pela API (409) e pela segunda sessão do painel (diálogo).
        const stale = writable(current)
        stale.revision = firstRevision
        const staleResponse = await page.request.put(path, {
          data: stale,
          headers: { Origin: origin, 'If-Match': JSON.stringify(firstRevision) },
        })
        expect(staleResponse.status()).toBe(409)
        expect(await catalogState(integration)).toEqual(before)
        await price(other).fill('52022')
        const conflict = other.waitForResponse(
          (r) => r.url().endsWith(path) && r.request().method() === 'PUT',
        )
        await save(other).click()
        expect((await conflict).status()).toBe(409)
        await expect(other.getByRole('dialog', { name: 'O catálogo mudou' })).toBeVisible()
        expect(await catalogState(integration)).toEqual(before)
        expect(await dbPrice(integration)).toBe(51000)
        await secondContext.close()

        // 12. Produtos e variantes originais intactos (a única mudança é a 20 L extra do Dronken).
        expect(originals()).toEqual(initial)
        const reread = await apiSnapshot()
        expect(reread.categories[0].items.find((i) => i.id === 'dronken')?.variants).toHaveLength(3)
        expect(reread.categories[1].items).toHaveLength(1)
      })
    })
  }
})

/**
 * F4A.6.3: seletor de imagens do carrossel editorial, sem mocks do CMS: build `release`, gateway e
 * sessão reais, D1 e R2 locais descartáveis. Só o processador de imagens é o do laboratório local.
 */
test.describe('F4A.6.3: imagens das entradas do carrossel no CMS real', () => {
  const COMMERCIAL = '5500000000000'
  for (const viewport of [
    { name: 'desktop 1440', width: 1440, height: 900 },
    { name: 'mobile 390', width: 390, height: 844 },
  ]) {
    test.describe(viewport.name, () => {
      test.use({
        mediaLab: true,
        runtimeMode: 'release',
        whatsappNumber: COMMERCIAL,
        viewport: { width: viewport.width, height: viewport.height },
      })

      type Entry = { itemId: string; media: { id: string; alt: string } | null }
      type Site = {
        draft: { revision: string; document: ReturnType<typeof previewFixture> }
      }
      const site = async (page: Page) =>
        (await page.request.get('/api/admin/site')).json() as Promise<Site>
      const entriesOf = (document: Site['draft']['document']) => {
        const carousel = document.modules.find((m) => m.template === 'carousel')
        if (carousel?.template !== 'carousel') throw new Error('sem carrossel')
        return { id: carousel.id, entries: carousel.content.entries as Entry[] }
      }
      const write = (
        page: Page,
        instance: Integration,
        action: 'saveDraft' | 'publish',
        revision: string,
        document: unknown,
      ) =>
        page.request.fetch(`/api/admin/site/${action === 'publish' ? 'publish' : 'draft'}`, {
          method: action === 'publish' ? 'POST' : 'PUT',
          headers: { Origin: instance.origin, 'If-Match': `"${revision}"` },
          data: { action, operationId: crypto.randomUUID(), expectedRevision: revision, document },
        })

      test('associar, salvar, reordenar, substituir, remover, publicar e cair no fallback', async ({
        page,
        browser,
        integration,
      }) => {
        test.setTimeout(240_000)
        await seedPreview(page, integration)
        const hero = await apiUpload(page, integration, await photo('png', '#445566'))
        const second = await apiUpload(page, integration, await photo('png', '#9db89a'))
        const third = await apiUpload(page, integration, await photo('png', '#aa6644'))
        expect([hero.status, second.status, third.status]).toEqual([200, 200, 200])
        // Rascunho publicável (hero com imagem, WhatsApp do build) com os barris dronken e heineken.
        let head = (await site(page)).draft
        const base = structuredClone(head.document)
        base.commercial.whatsappNumber = COMMERCIAL
        for (const module of base.modules)
          if (module.template === 'hero')
            module.content = { ...module.content, media: { id: hero.id, alt: 'Hero editorial' } }
        expect((await write(page, integration, 'saveDraft', head.revision, base)).status()).toBe(
          200,
        )
        head = (await site(page)).draft
        const { id: carouselId } = entriesOf(head.document)
        expect(entriesOf(head.document).entries.map((e) => e.itemId)).toEqual([
          'dronken',
          'heineken',
        ])
        const slot = (itemId: string) => page.locator(`[data-media-slot="${carouselId}:${itemId}"]`)
        const altOf = (itemId: string) =>
          slot(itemId).getByRole('textbox', { name: 'Texto alternativo da imagem' })
        const mediaState = () =>
          Object.fromEntries(
            entriesOf(head.document).entries.map((e) => [e.itemId, e.media]),
          ) as Record<string, { id: string; alt: string } | null>
        const refresh = async () => {
          head = (await site(page)).draft
          return mediaState()
        }
        const library = () => row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_media').n
        const libraryBefore = library()
        const openEditor = async () => {
          await page.goto('/admin#pagina-inicial')
          await page.reload() // sem isto a mesma URL manteria o estado local anterior
          await page.getByRole('button', { name: /Barris do catálogo/ }).click()
          await expect(slot('dronken')).toBeVisible()
        }

        // 1. Dronken: envia uma imagem nova pelo próprio seletor e associa; o foco vai ao alt.
        await openEditor()
        await expect(slot('dronken').getByText('Sem imagem editorial')).toBeVisible()
        await page.getByRole('button', { name: 'Escolher imagem de Dronken', exact: true }).click()
        await expect(mediaPicker(page)).toBeVisible()
        await mediaFile(page).setInputFiles(
          file('dronken.png', 'image/png', await photo('png', '#c8693f', 640, 480)),
        )
        await expect(uploaded(page)).toBeVisible({ timeout: 30_000 })
        const uploadedId = row<{ media_id: string }>(
          integration,
          'SELECT media_id FROM cms_media WHERE media_id NOT IN (?,?,?)',
          hero.id,
          second.id,
          third.id,
        ).media_id
        expect(library()).toBe(libraryBefore + 1)
        await confirmImage(page)
        await expect(altOf('dronken')).toBeFocused()
        // Sem texto alternativo: o rascunho aceita, mas o aviso aparece.
        await expect(slot('dronken').getByText('Sem texto alternativo.')).toBeVisible()
        await altOf('dronken').fill('Barril de chopp Dronken')

        // 2. Heineken: escolhe uma imagem já existente da biblioteca.
        await page.getByRole('button', { name: 'Escolher imagem de Heineken', exact: true }).click()
        await mediaTile(page, second.id).check()
        await confirmImage(page)
        await altOf('heineken').fill('Barril de chopp Heineken')
        // Nada gravado antes de salvar o rascunho.
        expect(await refresh()).toEqual({ dronken: null, heineken: null })

        // 3. Salvar rascunho e recarregar: a referência persiste, por itemId.
        await saveDraftButton(page).click()
        await expect(savedNotice(page)).toBeVisible()
        expect(await refresh()).toEqual({
          dronken: { id: uploadedId, alt: 'Barril de chopp Dronken' },
          heineken: { id: second.id, alt: 'Barril de chopp Heineken' },
        })
        await openEditor()
        await expect(altOf('dronken')).toHaveValue('Barril de chopp Dronken')
        await expect(altOf('heineken')).toHaveValue('Barril de chopp Heineken')
        await expect(slot('dronken').locator('img')).toBeVisible()

        // 4. Prévia autenticada: a imagem de cada produto, no cartão certo.
        const preview = await page.context().newPage()
        await preview.goto('/admin/preview')
        const frame = preview.frameLocator('iframe[title="Rascunho CMS v2"]')
        await expect(frame.getByRole('img', { name: 'Barril de chopp Dronken' })).toHaveAttribute(
          'src',
          `/api/admin/media/${uploadedId}/section`,
        )
        await preview.close()

        // 5. Reordenar: cada imagem continua no seu produto.
        await page.getByRole('button', { name: 'Subir Heineken', exact: true }).click()
        await saveDraftButton(page).click()
        await expect(savedNotice(page)).toBeVisible()
        expect(entriesOf((await site(page)).draft.document).entries.map((e) => e.itemId)).toEqual([
          'heineken',
          'dronken',
        ])
        expect(await refresh()).toEqual({
          dronken: { id: uploadedId, alt: 'Barril de chopp Dronken' },
          heineken: { id: second.id, alt: 'Barril de chopp Heineken' },
        })

        // 6. Substituir: troca o arquivo, mantém o alt para conferência e não apaga o arquivo antigo.
        await page.getByRole('button', { name: 'Trocar imagem de Dronken', exact: true }).click()
        await mediaTile(page, third.id).check()
        await confirmImage(page)
        await expect(altOf('dronken')).toHaveValue('Barril de chopp Dronken')
        await saveDraftButton(page).click()
        await expect(savedNotice(page)).toBeVisible()
        expect((await refresh()).dronken).toEqual({ id: third.id, alt: 'Barril de chopp Dronken' })
        expect(
          row<{ state: string }>(
            integration,
            'SELECT state FROM cms_media WHERE media_id=?',
            uploadedId,
          ).state,
        ).toBe('ready')

        // 7. Remover a associação da Heineken: o arquivo continua na biblioteca.
        const countBeforeRemoval = library()
        await page.getByRole('button', { name: 'Remover imagem de Heineken', exact: true }).click()
        await expect(slot('heineken').getByText('Sem imagem editorial')).toBeVisible()
        await saveDraftButton(page).click()
        await expect(savedNotice(page)).toBeVisible()
        expect((await refresh()).heineken).toBeNull()
        expect(library()).toBe(countBeforeRemoval)
        expect(
          row<{ state: string }>(
            integration,
            'SELECT state FROM cms_media WHERE media_id=?',
            second.id,
          ).state,
        ).toBe('ready')

        // 8. Referências inválidas: mídia inexistente é recusada no rascunho (nada é gravado).
        const ghost = structuredClone(head.document)
        const ghostEntry = entriesOf(ghost).entries.find((e) => e.itemId === 'heineken')
        if (ghostEntry) ghostEntry.media = { id: `media_${crypto.randomUUID()}`, alt: 'Fantasma' }
        const ghostSave = await write(page, integration, 'saveDraft', head.revision, ghost)
        expect(ghostSave.status()).toBe(400)
        expect((await refresh()).heineken).toBeNull()

        // 9. Texto alternativo é exigido para publicar (o rascunho aceita vazio).
        const noAlt = structuredClone(head.document)
        const noAltEntry = entriesOf(noAlt).entries.find((e) => e.itemId === 'dronken')
        if (noAltEntry?.media) noAltEntry.media.alt = ''
        expect((await write(page, integration, 'saveDraft', head.revision, noAlt)).status()).toBe(
          200,
        )
        head = (await site(page)).draft
        expect(
          (await write(page, integration, 'publish', head.revision, head.document)).status(),
        ).toBe(400)
        expect(
          row<{ id: string | null }>(
            integration,
            'SELECT published_version_id id FROM cms_v2_state',
          ).id,
        ).toBeNull()

        // 10. Com o alt de volta, publica pela interface e confere a vitrine pública real.
        await openEditor()
        await altOf('dronken').fill('Barril de chopp Dronken')
        await saveDraftButton(page).click()
        await expect(savedNotice(page)).toBeVisible()
        await page.getByRole('button', { name: 'Publicar', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Publicar na vitrine?' })
        await dialog.getByRole('button', { name: 'Publicar', exact: true }).click()
        await expect(
          page.getByText('Publicado. A vitrine passa a usar este conteúdo.'),
        ).toBeVisible()

        const shopContext = await browser.newContext({
          baseURL: integration.origin,
          viewport: { width: viewport.width, height: viewport.height },
        })
        const shop = await shopContext.newPage()
        try {
          await shop.goto('/')
          await expect(shop.locator('[data-editorial-state]')).toHaveAttribute(
            'data-editorial-state',
            'ready',
            { timeout: 20_000 },
          )
          const card = (name: string) =>
            shop
              .locator('#barris article')
              .filter({ has: shop.locator('h3', { hasText: new RegExp(`^${name}$`) }) })
          const image = card('Dronken').locator('img[src^="/api/site/media/"]')
          await expect(image).toHaveAttribute('src', `/api/site/media/${third.id}/section`)
          await expect(image).toHaveAttribute('alt', 'Barril de chopp Dronken')
          await expect
            .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
            .toBeGreaterThan(0)
          // Heineken ficou sem associação: foto atual, nenhuma imagem editorial.
          await expect(card('Heineken').locator('img[src^="/api/site/media/"]')).toHaveCount(0)
          await expect(
            card('Heineken').locator('img[alt="Barril de Chopp Heineken em Aço Inox"]'),
          ).toHaveCount(1)
          expect(
            await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true)
        } finally {
          await shopContext.close()
        }

        // 11. Imagem indisponível na vitrine: a foto atual permanece, sem imagem quebrada.
        const offline = await browser.newContext({
          baseURL: integration.origin,
          viewport: { width: viewport.width, height: viewport.height },
        })
        const failing = await offline.newPage()
        try {
          await failing.route('**/api/site/media/**', (route) => route.abort('failed'))
          await failing.goto('/')
          const dronkenCard = failing
            .locator('#barris article')
            .filter({ has: failing.locator('h3', { hasText: /^Dronken$/ }) })
          await expect(
            dronkenCard.locator('img[alt="Barril de Chopp Dronken em Aço Inox"]'),
          ).toHaveCount(1)
          await expect(dronkenCard.locator('img[src^="/api/site/media/"]')).toHaveCount(0)
          // PublishedMedia mantém o <img> (invisível, aria-hidden) até `load`; o erro troca para o
          // fallback no render seguinte. Espera a condição, sem sleep: imagem quebrada permanente falha.
          await expect
            .poll(() =>
              failing.evaluate(
                () => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length,
              ),
            )
            .toBe(0)
        } finally {
          await offline.close()
        }
      })
    })
  }
})

/**
 * F4A.6.4A: ciclo de vida da mídia editorial do carrossel, sem mocks do CMS: build `release`,
 * gateway e sessão reais, D1 e R2 locais descartáveis e o processador do laboratório local.
 */
test.describe('F4A.6.4A: ciclo de vida da mídia editorial do carrossel', () => {
  const COMMERCIAL = '5500000000000'
  test.use({ mediaLab: true, runtimeMode: 'release', whatsappNumber: COMMERCIAL })

  type Entry = { itemId: string; media: { id: string; alt: string } | null }
  type Doc = ReturnType<typeof previewFixture>
  type Site = { draft: { revision: string; document: Doc } }
  const site = async (page: Page) =>
    (await page.request.get('/api/admin/site')).json() as Promise<Site>
  const entriesOf = (document: Doc) => {
    const carousel = document.modules.find((m) => m.template === 'carousel')
    if (carousel?.template !== 'carousel') throw new Error('sem carrossel')
    return carousel.content.entries as Entry[]
  }
  const write = (
    page: Page,
    instance: Integration,
    action: 'saveDraft' | 'publish',
    revision: string,
    document: unknown,
  ) =>
    page.request.fetch(`/api/admin/site/${action === 'publish' ? 'publish' : 'draft'}`, {
      method: action === 'publish' ? 'POST' : 'PUT',
      headers: { Origin: instance.origin, 'If-Match': `"${revision}"` },
      data: { action, operationId: crypto.randomUUID(), expectedRevision: revision, document },
    })
  const deleteMedia = (
    page: Page,
    instance: Integration,
    media: { id: string; operationId: string },
  ) =>
    page.request.delete(`/api/admin/media/${media.id}`, {
      headers: {
        Origin: instance.origin,
        'X-Operation-Id': crypto.randomUUID(),
        'If-Match': `"${media.operationId}"`,
      },
    })
  const mediaRow = (instance: Integration, id: string) =>
    row<{ state: string }>(instance, 'SELECT state FROM cms_media WHERE media_id=?', id)

  test('estados inválidos, produto oculto, remoção, exclusão referenciada, concorrência e erros da biblioteca', async ({
    page,
    browser,
    integration,
  }) => {
    test.setTimeout(300_000)
    const origin = integration.origin
    await seedPreview(page, integration)
    const hero = await apiUpload(page, integration, await photo('png', '#445566'))
    const first = await apiUpload(page, integration, await photo('png', '#c8693f'))
    const second = await apiUpload(page, integration, await photo('png', '#9db89a'))
    const doomed = await apiUpload(page, integration, await photo('png', '#8fb3cf'))
    const bad = await apiUpload(page, integration, Buffer.from('isto não é uma imagem'))
    expect(bad.status).toBe(400)
    expect(mediaRow(integration, bad.id).state).toBe('rejected')
    expect((await deleteMedia(page, integration, doomed)).status()).toBe(200)
    expect(mediaRow(integration, doomed.id).state).toBe('deleted')

    let head = (await site(page)).draft
    const base = structuredClone(head.document)
    base.commercial.whatsappNumber = COMMERCIAL
    for (const module of base.modules)
      if (module.template === 'hero')
        module.content = { ...module.content, media: { id: hero.id, alt: 'Hero editorial' } }
    const withEntries = (media: Record<string, string | null>) => {
      const document = structuredClone(base)
      for (const entry of entriesOf(document))
        entry.media = media[entry.itemId]
          ? { id: media[entry.itemId] as string, alt: `Foto ${entry.itemId}` }
          : null
      return document
    }

    // 1. Mídia inexistente nem entra no rascunho. Recusada ou excluída entra (a chave existe), mas o
    // servidor a marca como "não pronta" e a publicação é recusada com nada publicado.
    const ghost = await write(
      page,
      integration,
      'saveDraft',
      head.revision,
      withEntries({ dronken: `media_${crypto.randomUUID()}` }),
    )
    expect(ghost.status()).toBe(400)
    expect(((await ghost.json()) as { error: { code: string } }).error.code).toBe(
      'CMS_INVALID_MEDIA',
    )
    // Excluída: o servidor recusa a referência já no rascunho.
    const deletedRef = await write(
      page,
      integration,
      'saveDraft',
      head.revision,
      withEntries({ dronken: doomed.id }),
    )
    expect(deletedRef.status()).toBe(400)
    // Rejeitada: o rascunho aceita (a chave existe), mas a publicação é recusada e nada é publicado.
    expect(
      (
        await write(page, integration, 'saveDraft', head.revision, withEntries({ dronken: bad.id }))
      ).status(),
    ).toBe(200)
    head = (await site(page)).draft
    const warnings = (
      (await (await page.request.get('/api/admin/site')).json()) as { warnings?: string[] }
    ).warnings
    expect(warnings).toContain('MEDIA_NOT_READY')
    const publish = await write(page, integration, 'publish', head.revision, head.document)
    expect(publish.status()).toBe(400)
    expect(((await publish.json()) as { error: { code: string } }).error.code).toBe(
      'CMS_INVALID_MEDIA',
    )
    expect(
      row<{ id: string | null }>(integration, 'SELECT published_version_id id FROM cms_v2_state')
        .id,
    ).toBeNull()
    // O painel explica a pendência e não deixa publicar enquanto houver imagem não pronta.
    await page.goto('/admin#pagina-inicial')
    await page.reload()
    await expect(
      page.getByText('Há imagem referenciada que ainda não está pronta para uso.').first(),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publicar', exact: true })).toBeDisabled()

    // 2. Rascunho válido e publicação V1: dronken e heineken com imagem.
    expect(
      (
        await write(
          page,
          integration,
          'saveDraft',
          head.revision,
          withEntries({ dronken: first.id, heineken: second.id }),
        )
      ).status(),
    ).toBe(200)
    head = (await site(page)).draft
    const v1 = head.document
    expect((await write(page, integration, 'publish', head.revision, v1)).status()).toBe(200)
    const refsOf = () =>
      integration.database.prepare('SELECT * FROM cms_v2_media_refs ORDER BY 1, 2').all()
    const refsV1 = refsOf()
    expect(refsV1.length).toBeGreaterThanOrEqual(3)

    // 3. Concorrência: publicar com revisão obsoleta não sobrescreve o conteúdo mais novo.
    const stale = head.revision // revisão anterior à publicação V1
    head = (await site(page)).draft
    const newer = withEntries({ dronken: first.id, heineken: second.id })
    for (const module of newer.modules)
      if (module.template === 'hero')
        module.content = { ...module.content, heading: 'Texto mais novo' }
    expect((await write(page, integration, 'saveDraft', head.revision, newer)).status()).toBe(200)
    head = (await site(page)).draft
    const versionsBefore = row<{ n: number }>(
      integration,
      'SELECT count(*) n FROM cms_v2_versions',
    ).n
    const obsolete = await write(page, integration, 'publish', stale, v1)
    expect(obsolete.status()).toBe(409)
    expect(row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_v2_versions').n).toBe(
      versionsBefore,
    )
    expect((await site(page)).draft.revision).toBe(head.revision)

    // 4. Produto oculto no catálogo: some da vitrine, a mídia não é pedida e o painel avisa.
    const catalog = (await (await page.request.get(path)).json()) as {
      revision: string
      categories: {
        items: {
          id: string
          visible: boolean
          creationRef?: unknown
          variants: Record<string, unknown>[]
        }[]
      }[]
    }
    for (const category of catalog.categories)
      for (const item of category.items) {
        delete item.creationRef
        for (const variant of item.variants) delete variant.creationRef
        if (item.id === 'heineken') item.visible = false
      }
    const hidden = await page.request.put(path, {
      data: catalog,
      headers: { Origin: origin, 'If-Match': JSON.stringify(catalog.revision) },
    })
    expect(hidden.status()).toBe(200)
    const shopContext = await browser.newContext({ baseURL: origin })
    const shop = await shopContext.newPage()
    const requested: string[] = []
    shop.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (pathname.startsWith('/api/site/media/')) requested.push(pathname)
    })
    try {
      await shop.goto('/')
      await expect(shop.locator('[data-editorial-state]')).toHaveAttribute(
        'data-editorial-state',
        'ready',
        {
          timeout: 20_000,
        },
      )
      await expect(shop.locator('#barris')).not.toContainText('Heineken')
      expect(requested.some((p) => p.includes(second.id))).toBe(false)
    } finally {
      await shopContext.close()
    }
    await page.goto('/admin#pagina-inicial')
    await page.reload()
    await page.getByRole('button', { name: /Barris do catálogo/ }).click()
    await expect(page.getByText(/heineken — referência não elegível/)).toBeVisible()
    // Remove a entrada inconsistente: a associação sai do rascunho, o arquivo continua na biblioteca.
    await page.getByRole('button', { name: 'Remover heineken', exact: true }).click()
    await saveDraftButton(page).click()
    await expect(savedNotice(page)).toBeVisible()
    head = (await site(page)).draft
    expect(entriesOf(head.document).map((e) => e.itemId)).toEqual(['dronken'])
    expect(mediaRow(integration, second.id).state).toBe('ready')

    // 5. Exclusão de mídia referenciada: MEDIA_REFERENCED (publicada V1), mesmo fora do rascunho.
    const referenced = await deleteMedia(page, integration, second)
    expect(referenced.status()).toBe(409)
    expect(((await referenced.json()) as { error: { code: string } }).error.code).toBe(
      'MEDIA_REFERENCED',
    )
    expect(mediaRow(integration, second.id).state).toBe('ready')

    // 6. Remover a associação do dronken e publicar V2: V1 e as referências históricas ficam intactas.
    const cleared = structuredClone(head.document)
    for (const entry of entriesOf(cleared)) entry.media = null
    expect((await write(page, integration, 'saveDraft', head.revision, cleared)).status()).toBe(200)
    head = (await site(page)).draft
    expect((await write(page, integration, 'publish', head.revision, head.document)).status()).toBe(
      200,
    )
    expect(refsOf()).toEqual(expect.arrayContaining(refsV1))
    for (const media of [first, second]) {
      const blocked = await deleteMedia(page, integration, media)
      expect(blocked.status()).toBe(409)
      expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
        'MEDIA_REFERENCED',
      )
      expect(mediaRow(integration, media.id).state).toBe('ready')
    }
    // A vitrine atual (V2) não tem imagem editorial: foto atual, em desktop e mobile.
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ baseURL: origin, viewport })
      const view = await context.newPage()
      try {
        await view.goto('/')
        await expect(view.locator('[data-editorial-state]')).toHaveAttribute(
          'data-editorial-state',
          'ready',
          { timeout: 20_000 },
        )
        await expect(view.locator('#barris img[src^="/api/site/media/"]')).toHaveCount(0)
        await expect(
          view.locator('#barris img[alt="Barril de Chopp Dronken em Aço Inox"]'),
        ).toHaveCount(1)
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      } finally {
        await context.close()
      }
    }

    // 7. Mídia sem nenhuma referência pode ser excluída; some da entrega e da biblioteca utilizável.
    const spare = await apiUpload(page, integration, await photo('png', '#aa6644'))
    expect((await deleteMedia(page, integration, spare)).status()).toBe(200)
    expect(mediaRow(integration, spare.id).state).toBe('deleted')

    // 8. Falha da biblioteca: mensagem clara, nada muda no rascunho e tentar de novo recupera.
    await page.goto('/admin#pagina-inicial')
    await page.reload()
    await page.getByRole('button', { name: /Barris do catálogo/ }).click()
    const before = (await site(page)).draft
    await page.route('**/api/admin/media?*', (route) => route.abort('failed'))
    await page.route('**/api/admin/media', (route) =>
      route.request().method() === 'GET' ? route.abort('failed') : route.continue(),
    )
    await page.getByRole('button', { name: 'Escolher imagem de Dronken', exact: true }).click()
    await expect(mediaPicker(page)).toBeVisible()
    await expect(mediaPicker(page).getByRole('alert').first()).toBeVisible()
    await expect(pickerUse(page)).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(mediaPicker(page)).toBeHidden()
    expect(await site(page)).toEqual({ ...(await site(page)), draft: before })
    await page.unroute('**/api/admin/media?*')
    await page.unroute('**/api/admin/media')
    await page.getByRole('button', { name: 'Escolher imagem de Dronken', exact: true }).click()
    await expect(mediaTile(page, first.id)).toBeEnabled()
    await expect(mediaTile(page, bad.id)).toBeDisabled()
    await expect(mediaTile(page, spare.id)).toBeDisabled()
  })
})

/**
 * F4A.6.4E: imagem principal do produto no painel, sem mocks: build `release`, gateway e sessão
 * reais, D1 e R2 locais descartáveis e o processador do laboratório local.
 */
test.describe('F4A.6.4E: imagem principal do produto no painel real', () => {
  const COMMERCIAL = '5500000000000'
  for (const viewport of [
    { name: 'desktop 1440', width: 1440, height: 900 },
    { name: 'mobile 390', width: 390, height: 844 },
  ]) {
    test.describe(viewport.name, () => {
      test.use({
        mediaLab: true,
        runtimeMode: 'release',
        whatsappNumber: COMMERCIAL,
        viewport: { width: viewport.width, height: viewport.height },
      })

      // O painel de imagem tem o próprio "Salvar imagem": aqui o salvamento do catálogo é pelo nome completo.
      const savedCatalog = async (page: Page) => {
        await page.getByRole('button', { name: /^Salvar( alterações)?$/ }).click() // celular: "Salvar"
        await expect(page.getByText('Tudo salvo.', { exact: true })).toBeVisible()
      }
      const imageApi = '/api/admin/catalog/media'
      type Assoc = { itemId: string; mediaId: string | null; alt: string | null; revision: string }
      const association = async (page: Page, itemId: string) =>
        (await (await page.request.get(`${imageApi}/${itemId}`)).json()) as Assoc
      const publicItem = async (page: Page, itemId: string) =>
        (
          (await (await page.request.get('/api/catalog')).json()) as {
            categories: { items: { id: string; image?: { id: string; alt: string } }[] }[]
          }
        ).categories
          .flatMap((c) => c.items)
          .find((i) => i.id === itemId)
      const toggle = (page: Page, name: string) =>
        page.getByRole('button', { name: `Imagem principal de ${name}`, exact: true })
      const panel = (page: Page, name: string) =>
        page.getByRole('region', { name: `Imagem principal de ${name}` })
      const altIn = (page: Page, name: string) =>
        panel(page, name).getByRole('textbox', { name: 'Texto alternativo da imagem' })
      const saveImage = (page: Page, name: string) =>
        panel(page, name).getByRole('button', { name: 'Salvar imagem' })
      const choose = (page: Page, name: string) =>
        panel(page, name).getByRole('button', {
          name: new RegExp(`^(Escolher|Trocar) imagem de ${name}$`),
        })
      const priceRevision = async (page: Page) =>
        ((await (await page.request.get(path)).json()) as { revision: string }).revision
      const catalogMetaRevision = (instance: Integration) =>
        row<{ revision: number }>(instance, 'SELECT revision FROM catalog_meta').revision

      test('a imagem editorial publicada vence a principal só no carrossel; sem editorial, vale a principal', async ({
        page,
        browser,
        integration,
      }) => {
        test.setTimeout(240_000)
        const origin = integration.origin
        await seedPreview(page, integration)
        const hero = await apiUpload(page, integration, await photo('png', '#445566'))
        const editorial = await apiUpload(page, integration, await photo('png', '#c8693f'))
        const mainDronken = await apiUpload(page, integration, await photo('png', '#9db89a'))
        const mainHeineken = await apiUpload(page, integration, await photo('png', '#aa6644'))
        const put = (itemId: string, mediaId: string, alt: string) =>
          page.request.put(`${imageApi}/${itemId}`, {
            headers: { Origin: origin, 'If-Match': '"m0"' },
            data: { mediaId, alt },
          })
        expect((await put('dronken', mainDronken.id, 'Principal do Dronken')).status()).toBe(200)
        expect((await put('heineken', mainHeineken.id, 'Principal da Heineken')).status()).toBe(200)
        // Publicação editorial: hero com imagem e só o Dronken com imagem editorial.
        const draft = (await (await page.request.get('/api/admin/site')).json()) as {
          draft: { revision: string; document: ReturnType<typeof previewFixture> }
        }
        const document = structuredClone(draft.draft.document)
        document.commercial.whatsappNumber = COMMERCIAL
        for (const module of document.modules) {
          if (module.template === 'hero')
            module.content = { ...module.content, media: { id: hero.id, alt: 'Hero editorial' } }
          if (module.template === 'carousel')
            for (const entry of module.content.entries)
              entry.media =
                entry.itemId === 'dronken'
                  ? { id: editorial.id, alt: 'Editorial do Dronken' }
                  : null
        }
        const send = (action: 'saveDraft' | 'publish', revision: string) =>
          page.request.fetch(`/api/admin/site/${action === 'publish' ? 'publish' : 'draft'}`, {
            method: action === 'publish' ? 'POST' : 'PUT',
            headers: { Origin: origin, 'If-Match': `"${revision}"` },
            data: {
              action,
              operationId: crypto.randomUUID(),
              expectedRevision: revision,
              document,
            },
          })
        expect((await send('saveDraft', draft.draft.revision)).status()).toBe(200)
        const head = (await (await page.request.get('/api/admin/site')).json()) as {
          draft: { revision: string }
        }
        expect((await send('publish', head.draft.revision)).status()).toBe(200)

        const context = await browser.newContext({
          baseURL: origin,
          viewport: { width: viewport.width, height: viewport.height },
        })
        const shop = await context.newPage()
        try {
          await shop.goto('/')
          await expect(shop.locator('[data-editorial-state]')).toHaveAttribute(
            'data-editorial-state',
            'ready',
            { timeout: 20_000 },
          )
          const card = (name: string) =>
            shop
              .locator('#barris article')
              .filter({ has: shop.locator('h3', { hasText: new RegExp(`^${name}$`) }) })
          const dronken = card('Dronken').locator('img[src^="/api/site/media/"]')
          await expect(dronken).toHaveAttribute('src', `/api/site/media/${editorial.id}/section`)
          await expect(dronken).toHaveAttribute('alt', 'Editorial do Dronken')
          await expect(card('Heineken').locator('img[src^="/api/site/media/"]')).toHaveAttribute(
            'src',
            `/api/site/media/${mainHeineken.id}/section`,
          )
          // A principal do Dronken segue valendo fora do carrossel (catálogo público) e é entregue.
          expect((await page.request.get('/api/catalog')).ok()).toBe(true)
          expect(
            (
              (await (await page.request.get('/api/catalog')).json()) as {
                categories: { items: { id: string; image?: { id: string } }[] }[]
              }
            ).categories
              .flatMap((c) => c.items)
              .find((i) => i.id === 'dronken')?.image?.id,
          ).toBe(mainDronken.id)
          expect(
            (await page.request.get(`/api/site/media/${mainDronken.id}/section`)).status(),
          ).toBe(200)
          const requested = await shop.evaluate(() =>
            performance
              .getEntriesByType('resource')
              .map((entry) => new URL(entry.name).pathname)
              .filter((path) => path.startsWith('/api/site/media/')),
          )
          // A principal do Dronken nem é requisitada pelo carrossel: a editorial a substituiu.
          expect(requested.some((path) => path.includes(mainDronken.id))).toBe(false)
        } finally {
          await context.close()
        }
      })

      test('produto padrão e novo: enviar, escolher, substituir, remover, concorrência e produto oculto', async ({
        page,
        browser,
        integration,
      }) => {
        test.setTimeout(300_000)
        const origin = integration.origin
        await login(page, integration)
        const second = await apiUpload(page, integration, await photo('png', '#9db89a'))
        const third = await apiUpload(page, integration, await photo('png', '#aa6644'))
        const doomed = await apiUpload(page, integration, await photo('png', '#8fb3cf'))
        const bad = await apiUpload(page, integration, Buffer.from('isto não é uma imagem'))
        expect([second.status, third.status, doomed.status, bad.status]).toEqual([
          200, 200, 200, 400,
        ])
        const gone = await page.request.delete(`/api/admin/media/${doomed.id}`, {
          headers: {
            Origin: origin,
            'X-Operation-Id': crypto.randomUUID(),
            'If-Match': `"${doomed.operationId}"`,
          },
        })
        expect(gone.status()).toBe(200)
        const library = () => row<{ n: number }>(integration, 'SELECT count(*) n FROM cms_media').n
        const priceBefore = await priceRevision(page)
        const metaBefore = catalogMetaRevision(integration)

        // 1. Produto padrão (linha da tabela): enviar uma imagem nova pelo próprio seletor.
        await toggle(page, 'Dronken').click()
        await expect(toggle(page, 'Dronken')).toHaveAttribute('aria-expanded', 'true')
        await expect(panel(page, 'Dronken')).toContainText('Aparece na vitrine assim que for salva')
        await expect(panel(page, 'Dronken')).toContainText('substitui esta imagem só no carrossel')
        await expect(panel(page, 'Dronken')).toContainText('Sem imagem principal')
        const libraryBefore = library()
        await choose(page, 'Dronken').click()
        await expect(mediaPicker(page)).toBeVisible()
        await mediaFile(page).setInputFiles(
          file('dronken.png', 'image/png', await photo('png', '#c8693f', 640, 480)),
        )
        await expect(uploaded(page)).toBeVisible({ timeout: 30_000 })
        expect(library()).toBe(libraryBefore + 1)
        await confirmImage(page)
        const uploadedId = row<{ media_id: string }>(
          integration,
          'SELECT media_id FROM cms_media WHERE media_id NOT IN (?,?,?,?)',
          second.id,
          third.id,
          doomed.id,
          bad.id,
        ).media_id
        // O foco vai ao texto alternativo; sem ele, não dá para salvar.
        await expect(altIn(page, 'Dronken')).toBeFocused()
        await expect(panel(page, 'Dronken')).toContainText('Sem texto alternativo')
        await expect(saveImage(page, 'Dronken')).toBeDisabled()
        await altIn(page, 'Dronken').fill('x'.repeat(201))
        await expect(saveImage(page, 'Dronken')).toBeDisabled()
        await altIn(page, 'Dronken').fill('Barril Dronken em aço')
        // Nada gravado antes de salvar.
        expect((await association(page, 'dronken')).mediaId).toBeNull()
        await saveImage(page, 'Dronken').click()
        await expect(panel(page, 'Dronken')).toContainText(
          'Imagem salva. Ela já aparece na vitrine.',
        )
        expect(await association(page, 'dronken')).toMatchObject({
          mediaId: uploadedId,
          alt: 'Barril Dronken em aço',
          revision: 'm1',
        })
        expect((await publicItem(page, 'dronken'))?.image).toEqual({
          id: uploadedId,
          alt: 'Barril Dronken em aço',
        })
        // Imagem não mexe na revisão de preços nem na do catálogo.
        expect(await priceRevision(page)).toBe(priceBefore)
        expect(catalogMetaRevision(integration)).toBe(metaBefore)

        // 2. Vitrine pública real, sem nenhuma publicação editorial.
        const shopContext = await browser.newContext({
          baseURL: origin,
          viewport: { width: viewport.width, height: viewport.height },
        })
        const shop = await shopContext.newPage()
        const shopCard = (name: string) =>
          shop
            .locator('#barris article')
            .filter({ has: shop.locator('h3', { hasText: new RegExp(`^${name}$`) }) })
        try {
          await shop.goto('/')
          const image = shopCard('Dronken').locator('img[src^="/api/site/media/"]')
          await expect(image).toHaveAttribute('src', `/api/site/media/${uploadedId}/section`)
          await expect(image).toHaveAttribute('alt', 'Barril Dronken em aço')
          await expect
            .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
            .toBeGreaterThan(0)
          expect(
            await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true)
        } finally {
          await shopContext.close()
        }

        // 3. Persistência após reload real; substituir mantém o alt e sobe a revisão.
        await page.reload()
        await toggle(page, 'Dronken').click()
        await expect(altIn(page, 'Dronken')).toHaveValue('Barril Dronken em aço')
        await choose(page, 'Dronken').click()
        await mediaTile(page, third.id).check()
        await confirmImage(page)
        await expect(altIn(page, 'Dronken')).toHaveValue('Barril Dronken em aço')
        await saveImage(page, 'Dronken').click()
        await expect(panel(page, 'Dronken')).toContainText('Imagem salva')
        expect(await association(page, 'dronken')).toMatchObject({
          mediaId: third.id,
          revision: 'm2',
        })
        // Só o alt também é uma revisão nova.
        await altIn(page, 'Dronken').fill('Barril Dronken, de frente')
        await saveImage(page, 'Dronken').click()
        await expect(panel(page, 'Dronken')).toContainText('Imagem salva')
        expect(await association(page, 'dronken')).toMatchObject({
          alt: 'Barril Dronken, de frente',
          revision: 'm3',
        })

        // 4. Remover: o arquivo fica na biblioteca e a vitrine volta à foto atual.
        const before = library()
        await panel(page, 'Dronken')
          .getByRole('button', { name: 'Remover imagem de Dronken', exact: true })
          .click()
        await saveImage(page, 'Dronken').click()
        await expect(panel(page, 'Dronken')).toContainText('Imagem removida')
        expect(await association(page, 'dronken')).toMatchObject({ mediaId: null, revision: 'm4' })
        expect((await publicItem(page, 'dronken'))?.image).toBeUndefined()
        expect(library()).toBe(before)
        expect(
          row<{ state: string }>(
            integration,
            'SELECT state FROM cms_media WHERE media_id=?',
            third.id,
          ).state,
        ).toBe('ready')

        // 5. Mídia recusada ou excluída aparece bloqueada na biblioteca; e uma que ficar indisponível
        // depois da escolha é recusada pelo servidor, com mensagem clara e sem gravar.
        await choose(page, 'Dronken').click()
        await expect(mediaTile(page, bad.id)).toBeDisabled()
        await expect(mediaTile(page, doomed.id)).toBeDisabled()
        await mediaTile(page, second.id).check()
        await confirmImage(page)
        await altIn(page, 'Dronken').fill('Vai falhar')
        const removed = await page.request.delete(`/api/admin/media/${second.id}`, {
          headers: {
            Origin: origin,
            'X-Operation-Id': crypto.randomUUID(),
            'If-Match': `"${second.operationId}"`,
          },
        })
        expect(removed.status()).toBe(200)
        await saveImage(page, 'Dronken').click()
        await expect(panel(page, 'Dronken')).toContainText('O servidor recusou a imagem')
        expect(await association(page, 'dronken')).toMatchObject({ mediaId: null, revision: 'm4' })

        // 6. Duas sessões: a segunda leu a revisão antiga, perde com 409 e nada é sobrescrito.
        const otherContext = await browser.newContext({
          baseURL: origin,
          viewport: { width: viewport.width, height: viewport.height },
        })
        const other = await otherContext.newPage()
        try {
          await login(other, integration)
          await toggle(other, 'Dronken').click()
          await expect(choose(other, 'Dronken')).toBeVisible()
          const fourth = await apiUpload(page, integration, await photo('png', '#445566'))
          const fifth = await apiUpload(page, integration, await photo('png', '#778899'))
          // A primeira sessão ganha pela API (mesma revisão que a segunda leu: m4).
          const win = await page.request.put(`${imageApi}/dronken`, {
            headers: { Origin: origin, 'If-Match': '"m4"' },
            data: { mediaId: fourth.id, alt: 'Primeira sessão' },
          })
          expect(win.status()).toBe(200)
          await choose(other, 'Dronken').click()
          await mediaTile(other, fifth.id).check()
          await confirmImage(other)
          await altIn(other, 'Dronken').fill('Segunda sessão')
          await saveImage(other, 'Dronken').click()
          await expect(panel(other, 'Dronken')).toContainText('alterada em outra sessão')
          expect(await association(page, 'dronken')).toMatchObject({
            mediaId: fourth.id,
            alt: 'Primeira sessão',
            revision: 'm5',
          })
          // Recarregar mostra a versão vencedora e descarta a escolha local.
          await panel(other, 'Dronken').getByRole('button', { name: 'Recarregar imagem' }).click()
          await expect(altIn(other, 'Dronken')).toHaveValue('Primeira sessão')
        } finally {
          await otherContext.close()
        }

        // 7. Produto novo: sem salvar não há imagem; depois de salvar, recebe a própria.
        await add(page, 'Chopes', 'Chope com foto', '20', '12345')
        await expect(toggle(page, 'Chope com foto')).toBeDisabled()
        await savedCatalog(page)
        await expect(toggle(page, 'Chope com foto')).toBeEnabled()
        await toggle(page, 'Chope com foto').click()
        await choose(page, 'Chope com foto').click()
        await mediaTile(page, third.id).check()
        await confirmImage(page)
        await altIn(page, 'Chope com foto').fill('Foto do chope novo')
        await saveImage(page, 'Chope com foto').click()
        await expect(panel(page, 'Chope com foto')).toContainText('Imagem salva')
        const newId = row<{ id: string }>(
          integration,
          'SELECT id FROM catalog_items WHERE name=?',
          'Chope com foto',
        ).id
        expect(await association(page, newId)).toMatchObject({ mediaId: third.id, revision: 'm1' })

        // 8. Produto oculto: a imagem pode ser escolhida e fica guardada, mas não é entregue.
        const sixth = await apiUpload(page, integration, await photo('png', '#bb9944'))
        await page.getByRole('switch', { name: 'Heineken visível no site' }).uncheck()
        await savedCatalog(page)
        await toggle(page, 'Heineken').click()
        await expect(panel(page, 'Heineken')).toContainText('Este produto está oculto')
        await choose(page, 'Heineken').click()
        await mediaTile(page, sixth.id).check()
        await confirmImage(page)
        await altIn(page, 'Heineken').fill('Heineken oculta')
        await saveImage(page, 'Heineken').click()
        await expect(panel(page, 'Heineken')).toContainText('O produto está oculto')
        expect((await association(page, 'heineken')).mediaId).toBe(sixth.id)
        expect(await publicItem(page, 'heineken')).toBeUndefined()
        expect((await page.request.get(`/api/site/media/${sixth.id}/section`)).status()).toBe(404)
        // Exibir o produto volta a entregar a imagem e a expô-la no catálogo.
        await page.getByRole('switch', { name: 'Heineken visível no site' }).check()
        await savedCatalog(page)
        expect((await page.request.get(`/api/site/media/${sixth.id}/section`)).status()).toBe(200)
        expect((await publicItem(page, 'heineken'))?.image?.id).toBe(sixth.id)
      })
    })
  }
})
