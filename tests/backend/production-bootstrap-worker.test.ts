import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyPassword } from '../../server/auth/password'
import worker, {
  ARMED,
  MAX_WINDOW_MS,
  type ProductionBootstrapEnv,
} from '../../server/auth/production-bootstrap-worker'
import { authFixture } from './auth-fixture'

// Núcleo real (bootstrapOwner, PBKDF2, D1 em Miniflare descartável). Nenhum recurso remoto,
// credencial real ou migration remota é usado.
const id = '12345678-1234-4123-8123-123456789012'
const password = 'Frase longa exclusiva do teste de producao'
const pepper = 'cd'.repeat(32)
const origin = 'https://chopp-prod.example'
const NOW = 1_800_000_000_000
const command = (change: Record<string, unknown> = {}) => ({
  commandId: id,
  environment: 'production',
  action: 'bootstrap',
  origin,
  expiresAt: NOW + 30 * 60 * 1000,
  username: 'owner',
  expectedAuthVersion: 0,
  ...change,
})
const event = () => ({ noRetry: vi.fn() })
const logged = () =>
  JSON.stringify([...vi.mocked(console.info).mock.calls, ...vi.mocked(console.error).mock.calls])

describe('bootstrap do primeiro administrador de produção', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  const env = (change: Partial<ProductionBootstrapEnv> = {}): ProductionBootstrapEnv => ({
    DELEGAS_DB: fixture.db,
    PRODUCTION_BOOTSTRAP_ENABLED: ARMED,
    PRODUCTION_BOOTSTRAP_ENVIRONMENT: 'production',
    PRODUCTION_BOOTSTRAP_COMMAND: JSON.stringify(command()),
    PRODUCTION_BOOTSTRAP_PASSWORD: password,
    ADMIN_ORIGIN: origin,
    ADMIN_PASSWORD_PEPPER: pepper,
    ...change,
  })
  const owners = async () =>
    (await fixture.db.prepare('SELECT id, username, password_hash FROM admin_users').all()).results

  beforeEach(async () => {
    fixture = await authFixture()
    await fixture.db.batch([
      fixture.db.prepare(
        'CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)',
      ),
      fixture.db
        .prepare('INSERT INTO d1_migrations (name) VALUES (?), (?)')
        .bind('0003_admin_auth.sql', '0012_cms_publication.sql'),
    ])
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
    vi.restoreAllMocks()
  })

  it('não tem HTTP, rota, preview, cron nem recurso de mídia, e o estado versionado é desarmado', () => {
    expect(Object.keys(worker)).toEqual(['scheduled'])
    const raw = readFileSync('config/cloudflare/production-bootstrap-worker.jsonc', 'utf8')
    const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''))
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    expect(config.routes).toEqual([])
    expect(config.triggers.crons).toEqual([])
    expect(config.vars.PRODUCTION_BOOTSTRAP_ENABLED).toBe('disabled')
    expect(config.r2_buckets).toBeUndefined()
    expect(config.services).toBeUndefined()
    // Nada da homologação: nome do Worker, banco e id de D1 distintos; id real nunca versionado.
    const homologation = readFileSync('wrangler.homologation.jsonc', 'utf8')
    const maintenance = JSON.parse(
      readFileSync('config/cloudflare/maintenance-worker.jsonc', 'utf8'),
    )
    expect(config.name).not.toBe(maintenance.name)
    expect(config.d1_databases).toHaveLength(1)
    expect(config.d1_databases[0].database_id).toBe('REPLACE_WITH_PRODUCTION_D1_ID')
    expect(homologation).not.toContain(config.d1_databases[0].database_name)
    expect(raw).not.toMatch(/[a-f0-9]{32}/)
    expect(JSON.stringify(config.vars)).not.toMatch(/homolog/i)
  })

  it('cria somente o primeiro administrador, com o hash existente, e não loga segredos', async () => {
    const tick = event()
    await worker.scheduled(tick, env())
    expect(tick.noRetry).toHaveBeenCalledTimes(1)
    const rows = await owners()
    expect(rows).toHaveLength(1)
    expect(rows[0].username).toBe('owner')
    expect(await verifyPassword(password, rows[0].password_hash as string, pepper)).toBe(true)
    expect(console.info).toHaveBeenCalledWith('PRODUCTION_BOOTSTRAP', {
      commandId: id,
      result: 'APPLIED',
    })
    const output = logged()
    for (const secret of [password, pepper, rows[0].password_hash as string])
      expect(output).not.toContain(secret)
  })

  it.each(['aB3$eF7h', 'aB3$'.repeat(32)])(
    'aceita senha nos limites (8 e 128 caracteres) e a recusa de 7 deixa a etapa fixa no log',
    async (strong) => {
      await worker.scheduled(event(), env({ PRODUCTION_BOOTSTRAP_PASSWORD: 'aB3$eF7' }))
      expect(await owners()).toHaveLength(0)
      expect(console.error).toHaveBeenCalledWith('PRODUCTION_BOOTSTRAP', {
        commandId: id,
        result: 'REFUSED_OR_UNCONFIRMED',
        stage: 'credentials_validation',
      })
      await worker.scheduled(event(), env({ PRODUCTION_BOOTSTRAP_PASSWORD: strong }))
      const rows = await owners()
      expect(rows).toHaveLength(1)
      expect(await verifyPassword(strong, rows[0].password_hash as string, pepper)).toBe(true)
      expect(logged()).not.toContain(strong)
    },
  )

  it('repetição após sucesso recusa sem alterar a conta', async () => {
    await worker.scheduled(event(), env())
    const [before] = await owners()
    await worker.scheduled(
      event(),
      env({
        PRODUCTION_BOOTSTRAP_COMMAND: JSON.stringify(command({ username: 'outro-dono' })),
        PRODUCTION_BOOTSTRAP_PASSWORD: 'Outra frase longa para outro dono',
      }),
    )
    expect(await owners()).toEqual([before])
    expect(console.info).toHaveBeenLastCalledWith('PRODUCTION_BOOTSTRAP', {
      commandId: id,
      result: 'NOT_APPLIED',
    })
  })

  it('execuções concorrentes criam exatamente uma conta', async () => {
    await Promise.all([worker.scheduled(event(), env()), worker.scheduled(event(), env())])
    expect(await owners()).toHaveLength(1)
  })

  it('fica inerte sem o armamento próprio, inclusive com o valor de armamento da homologação', async () => {
    for (const enabled of [undefined, 'disabled', 'armed-v1'])
      await worker.scheduled(event(), env({ PRODUCTION_BOOTSTRAP_ENABLED: enabled }))
    await worker.scheduled(event(), {
      ...env({ PRODUCTION_BOOTSTRAP_ENABLED: undefined }),
      MAINTENANCE_ENABLED: 'armed-v1',
    })
    expect(await owners()).toHaveLength(0)
    expect(console.error).not.toHaveBeenCalled()
    for (const call of vi.mocked(console.info).mock.calls)
      expect(call).toEqual(['PRODUCTION_BOOTSTRAP', { result: 'DISARMED' }])
  })

  it.each<[string, Partial<ProductionBootstrapEnv>]>([
    ['ambiente errado', { PRODUCTION_BOOTSTRAP_ENVIRONMENT: 'homologation' }],
    ['sem D1', { DELEGAS_DB: undefined }],
    ['origem http', { ADMIN_ORIGIN: 'http://chopp-prod.example' }],
    ['origem loopback', { ADMIN_ORIGIN: 'https://localhost' }],
    ['origem com caminho', { ADMIN_ORIGIN: `${origin}/admin` }],
    ['origem de homologação', { ADMIN_ORIGIN: 'https://chopp-delivery-homolog.pages.dev' }],
    ['sem origem', { ADMIN_ORIGIN: undefined }],
    ['sem pepper', { ADMIN_PASSWORD_PEPPER: undefined }],
    ['pepper inválido', { ADMIN_PASSWORD_PEPPER: 'curto' }],
    ['sem senha', { PRODUCTION_BOOTSTRAP_PASSWORD: undefined }],
    ['senha fraca', { PRODUCTION_BOOTSTRAP_PASSWORD: 'curta' }],
    ['senha com 7 caracteres', { PRODUCTION_BOOTSTRAP_PASSWORD: 'aB3$eF7' }],
    ['senha comum com 8+ caracteres', { PRODUCTION_BOOTSTRAP_PASSWORD: 'Password123' }],
    ['senha com 129 caracteres', { PRODUCTION_BOOTSTRAP_PASSWORD: `${'aB3$'.repeat(32)}x` }],
    ['insecure local', { ADMIN_ALLOW_INSECURE_LOCAL: '1' }],
    ['mídia local', { CMS_MEDIA_LOCAL: 'disposable-v1' }],
    ['gate de mídia', { CMS_MEDIA_ENABLED: 'enabled' }],
    ['bucket de mídia', { CMS_MEDIA_BUCKET: {} }],
    ['processador de mídia', { CMS_MEDIA_PROCESSOR: {} }],
    ['credencial de manutenção da homologação', { MAINTENANCE_PASSWORD: password }],
    ['comando de manutenção da homologação', { MAINTENANCE_COMMAND: '{}' }],
  ])('falha fechada e sem criar conta: %s', async (_name, change) => {
    await worker.scheduled(event(), env(change))
    expect(await owners()).toHaveLength(0)
    expect(console.error).toHaveBeenCalled()
    const output = logged()
    for (const secret of [password, pepper]) expect(output).not.toContain(secret)
  })

  it.each<[string, Record<string, unknown>]>([
    ['ambiente do comando', { environment: 'homologation' }],
    ['origem do comando diferente', { origin: 'https://outra-origem.example' }],
    ['ação desconhecida', { action: 'recover' }],
    ['versão esperada', { expectedAuthVersion: 1 }],
    ['sem versão', { expectedAuthVersion: undefined }],
    ['id inválido', { commandId: 'nao-e-uuid' }],
    ['campo extra com segredo', { extra: password }],
    ['expirado', { expiresAt: NOW - 1 }],
    ['janela longa demais', { expiresAt: NOW + MAX_WINDOW_MS + 1 }],
    ['sem prazo', { expiresAt: undefined }],
    ['usuário inválido', { username: 'A B' }],
  ])('recusa comando: %s', async (_name, change) => {
    await worker.scheduled(
      event(),
      env({ PRODUCTION_BOOTSTRAP_COMMAND: JSON.stringify(command(change)) }),
    )
    expect(await owners()).toHaveLength(0)
    expect(logged()).not.toContain(password)
  })

  it('recusa banco sem as migrations de produção (D1 incorreto ou incompleto)', async () => {
    await fixture.db
      .prepare("DELETE FROM d1_migrations WHERE name = '0012_cms_publication.sql'")
      .run()
    await worker.scheduled(event(), env())
    expect(await owners()).toHaveLength(0)
  })

  it('falha parcial no hash não grava nada e registra só a etapa fixa', async () => {
    const spy = vi
      .spyOn(crypto.subtle, 'deriveBits')
      .mockRejectedValueOnce(new Error(`${password} ${pepper} CRYPTO_SENTINEL`))
    await worker.scheduled(event(), env())
    spy.mockRestore()
    expect(await owners()).toHaveLength(0)
    expect(console.error).toHaveBeenCalledWith('PRODUCTION_BOOTSTRAP', {
      commandId: id,
      result: 'REFUSED_OR_UNCONFIRMED',
      stage: 'password_hash',
    })
    expect(logged()).not.toMatch(/CRYPTO_SENTINEL|Frase longa/)
    // Recuperação segura: reexecutar o mesmo comando cria a conta uma única vez.
    await worker.scheduled(event(), env())
    await worker.scheduled(event(), env())
    expect(await owners()).toHaveLength(1)
  })

  it('inspect confirma o estado sem hash, senha nem pepper e não cria conta', async () => {
    const inspect = env({
      PRODUCTION_BOOTSTRAP_COMMAND: JSON.stringify(
        command({ action: 'inspect', username: undefined, expectedAuthVersion: undefined }),
      ),
      PRODUCTION_BOOTSTRAP_PASSWORD: undefined,
    })
    await worker.scheduled(event(), inspect)
    expect(await owners()).toHaveLength(0)
    expect(console.info).toHaveBeenLastCalledWith('PRODUCTION_BOOTSTRAP', {
      commandId: id,
      result: 'INSPECTED',
      armed: true,
      owner: null,
    })
    await worker.scheduled(event(), env())
    const [row] = await owners()
    await worker.scheduled(event(), inspect)
    expect(console.info).toHaveBeenLastCalledWith('PRODUCTION_BOOTSTRAP', {
      commandId: id,
      result: 'INSPECTED',
      armed: true,
      owner: { username: 'owner', active: true, authVersion: 1 },
    })
    expect(logged()).not.toContain(row.password_hash as string)
  })
})
