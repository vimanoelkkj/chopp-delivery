import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EXPECTED_ACCOUNT_ID,
  PRODUCTION_D1_ID,
  PRODUCTION_D1_NAME,
} from '../../scripts/production-account-guard.mjs'
import {
  BUILD_DIR,
  checkDeployDir,
  PRODUCTION_CONFIG_SHA256,
  PRODUCTION_MEDIA_BUCKET,
  PRODUCTION_MEDIA_PROCESSOR,
  PROFILES,
  preflight,
  processorGate,
} from '../../scripts/production-pages-deploy.mjs'

// Perfis de configuração de produção (base, media-closed, media-open) e os dois gates de mídia.
// Nada é publicado: as leituras remotas do wrangler são injetadas.

interface Cfg {
  vars: Record<string, string>
  r2_buckets: { binding: string; bucket_name: string; jurisdiction?: string }[]
  services: { binding: string; service: string }[]
  d1_databases: { database_id: string }[]
  env: { preview: { r2_buckets: unknown; services: unknown } }
}
const read = (file: string) => readFileSync(file, 'utf8')
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const okEnv = { CLOUDFLARE_ACCOUNT_ID: EXPECTED_ACCOUNT_ID }
const okInfo = () => JSON.stringify({ uuid: PRODUCTION_D1_ID, name: PRODUCTION_D1_NAME })
const VERSION = '11111111-2222-4333-8444-555555555555'

describe('arquivos revisados dos perfis', () => {
  it('cada perfil tem o hash fixo do arquivo versionado', () => {
    expect(PROFILES.base.sha256).toBe(PRODUCTION_CONFIG_SHA256)
    for (const [name, spec] of Object.entries(PROFILES))
      expect(sha(read(spec.file)), name).toBe(spec.sha256)
  })

  it('media-open difere de media-closed em exatamente uma linha (o gate do Pages)', () => {
    const closed = read(PROFILES['media-closed'].file).split('\n')
    const open = read(PROFILES['media-open'].file).split('\n')
    expect(open).toHaveLength(closed.length)
    const diff = closed.flatMap((line, index) =>
      line === open[index] ? [] : [[line, open[index]]],
    )
    expect(diff).toEqual([
      ['    "CMS_MEDIA_ENABLED": "disabled"', '    "CMS_MEDIA_ENABLED": "enabled"'],
    ])
  })

  it('os perfis de mídia só acrescentam as variáveis e os dois bindings exatos à base', () => {
    const base = JSON.parse(read(PROFILES.base.file))
    for (const profile of ['media-closed', 'media-open'] as const) {
      const config = JSON.parse(read(PROFILES[profile].file))
      expect({ ...config, vars: base.vars, r2_buckets: [], services: [] }).toEqual(base)
      expect(config.vars).toEqual({
        ADMIN_ORIGIN: 'https://chopp-delivery-prod.pages.dev',
        CMS_MEDIA_ENVIRONMENT: 'production',
        CMS_MEDIA_ENABLED: PROFILES[profile].gate,
      })
      expect(config.r2_buckets).toEqual([
        { binding: 'CMS_MEDIA_BUCKET', bucket_name: PRODUCTION_MEDIA_BUCKET },
      ])
      expect(config.services).toEqual([
        { binding: 'CMS_MEDIA_PROCESSOR', service: PRODUCTION_MEDIA_PROCESSOR },
      ])
      expect(config.env.preview).toEqual({
        d1_databases: [],
        vars: {},
        r2_buckets: [],
        services: [],
      })
      expect(JSON.stringify(config)).not.toMatch(/homolog/i)
    }
  })

  it('o Worker processador de produção nasce FECHADO e a variante aberta difere só na variável', () => {
    const closedText = read('config/cloudflare/production-media-processor.jsonc')
    const openText = read('config/cloudflare/production-media-processor-open.jsonc')
    expect(closedText).toMatch(/"CMS_MEDIA_PROCESSOR_ENABLED": "disabled"/)
    expect(openText).toMatch(/"CMS_MEDIA_PROCESSOR_ENABLED": "enabled"/)
    const code = (text: string) => text.split('\n').filter((l) => !l.trim().startsWith('//'))
    const [a, b] = [code(closedText), code(openText)]
    expect(a).toHaveLength(b.length)
    expect(a.flatMap((line, i) => (line === b[i] ? [] : [line]))).toEqual([
      '    "CMS_MEDIA_PROCESSOR_ENABLED": "disabled"',
    ])
    const config = JSON.parse(code(closedText).join('\n'))
    expect(config).toMatchObject({
      name: PRODUCTION_MEDIA_PROCESSOR,
      workers_dev: false,
      preview_urls: false,
      routes: [],
      images: { binding: 'IMAGES' },
    })
    expect(config.triggers).toEqual({ crons: [] })
    for (const forbidden of ['d1_databases', 'r2_buckets', 'services', 'kv_namespaces'])
      expect(config[forbidden], forbidden).toBeUndefined()
  })
})

describe('checkDeployDir por perfil', () => {
  let dir: string
  const place = (file: string) => writeFileSync(join(dir, 'wrangler.jsonc'), read(file))
  const set = (config: unknown) =>
    writeFileSync(join(dir, 'wrangler.jsonc'), JSON.stringify(config))
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chopp-profile-'))
    mkdirSync(join(dir, BUILD_DIR, 'assets'), { recursive: true })
    writeFileSync(join(dir, BUILD_DIR, 'index.html'), '<!doctype html>')
    mkdirSync(join(dir, 'functions', 'api'), { recursive: true })
    writeFileSync(join(dir, 'functions', 'api', 'products.ts'), 'export {}')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it.each(['base', 'media-closed', 'media-open'] as const)(
    'aprova o perfil %s com seu arquivo revisado',
    (profile) => {
      place(PROFILES[profile].file)
      expect(checkDeployDir(dir, { profile })).toEqual([])
    },
  )

  it('perfil desconhecido é recusado', () => {
    place(PROFILES.base.file)
    expect(checkDeployDir(dir, { profile: 'x' as never })).toEqual(['perfil desconhecido: x'])
  })

  it('o perfil base continua recusando R2 e serviços (bloqueio de infraestrutura mantido)', () => {
    place(PROFILES['media-closed'].file)
    const problems = checkDeployDir(dir).join()
    expect(problems).toMatch(/vars deve conter somente ADMIN_ORIGIN/)
    expect(problems).toMatch(/R2 nem serviços/)
    expect(problems).toMatch(/difere do wrangler\.production\.jsonc/)
  })

  it('arquivo de um perfil não passa em outro (aberto x fechado x base)', () => {
    place(PROFILES['media-open'].file)
    expect(checkDeployDir(dir, { profile: 'media-closed' }).join()).toMatch(/CMS_MEDIA_ENABLED/)
    place(PROFILES['media-closed'].file)
    expect(checkDeployDir(dir, { profile: 'media-open' }).join()).toMatch(/CMS_MEDIA_ENABLED/)
    place(PROFILES.base.file)
    expect(checkDeployDir(dir, { profile: 'media-closed' }).join()).toMatch(/exatamente/)
  })

  it.each([
    [
      'bucket da homologação',
      (c: Cfg) => (c.r2_buckets[0].bucket_name = 'chopp-cms-media-homologation'),
      /homolog|r2_buckets deve/,
    ],
    [
      'bucket com outro nome',
      (c: Cfg) => (c.r2_buckets[0].bucket_name = 'outro-bucket'),
      /r2_buckets deve ser exatamente/,
    ],
    [
      'segundo bucket',
      (c: Cfg) => c.r2_buckets.push({ binding: 'OUTRO', bucket_name: 'x' }),
      /r2_buckets deve ser exatamente/,
    ],
    [
      'binding do bucket com outro nome',
      (c: Cfg) => (c.r2_buckets[0].binding = 'BUCKET'),
      /r2_buckets deve ser exatamente/,
    ],
    [
      'campo extra no bucket',
      (c: Cfg) => (c.r2_buckets[0].jurisdiction = 'eu'),
      /r2_buckets deve ser exatamente/,
    ],
    [
      'serviço da homologação',
      (c: Cfg) => (c.services[0].service = 'chopp-cms-image-processor-homologation'),
      /homolog|services deve/,
    ],
    [
      'segundo serviço',
      (c: Cfg) => c.services.push({ binding: 'X', service: 'y' }),
      /services deve ser exatamente/,
    ],
    ['serviço ausente', (c: Cfg) => (c.services = []), /services deve ser exatamente/],
    ['bucket ausente', (c: Cfg) => (c.r2_buckets = []), /r2_buckets deve ser exatamente/],
    [
      'ambiente de mídia errado',
      (c: Cfg) => (c.vars.CMS_MEDIA_ENVIRONMENT = 'homologation'),
      /homolog|vars do perfil/,
    ],
    ['variável extra', (c: Cfg) => (c.vars.EXTRA = '1'), /vars do perfil/],
    [
      'ADMIN_ORIGIN diferente',
      (c: Cfg) => (c.vars.ADMIN_ORIGIN = 'https://x.pages.dev'),
      /vars do perfil|ADMIN_ORIGIN/,
    ],
    ['preview com R2', (c: Cfg) => (c.env.preview.r2_buckets = c.r2_buckets), /env\.preview/],
    ['preview com serviço', (c: Cfg) => (c.env.preview.services = c.services), /env\.preview/],
    [
      'D1 de outro banco',
      (c: Cfg) => (c.d1_databases[0].database_id = '00000000-0000-4000-8000-000000000000'),
      /DELEGAS_DB/,
    ],
  ])('perfil de mídia recusa: %s', (_name, change, expected) => {
    const config = JSON.parse(read(PROFILES['media-closed'].file))
    change(config)
    set(config)
    const problems = checkDeployDir(dir, { profile: 'media-closed' }).join()
    expect(problems).toMatch(expected)
    expect(problems).toMatch(/hash fixo|difere do/) // nenhuma variação passa pelo hash revisado
  })
})

describe('preflight dos perfis de mídia (leituras injetadas)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chopp-profile-pre-'))
    mkdirSync(join(dir, BUILD_DIR), { recursive: true })
    writeFileSync(join(dir, BUILD_DIR, 'index.html'), '<!doctype html>')
    mkdirSync(join(dir, 'functions', 'api'), { recursive: true })
    writeFileSync(join(dir, 'functions', 'api', 'products.ts'), 'export {}')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const fake =
    (opts: { bucket?: boolean; worker?: 'enabled' | 'disabled' | 'missing' } = {}) =>
    (args: string[]) => {
      const key = args.join(' ')
      if (key === 'pages project list --json')
        return JSON.stringify([{ 'Project Name': 'chopp-delivery-prod' }])
      if (key === 'r2 bucket list')
        return opts.bucket === false
          ? 'name:           outro\n'
          : `name:           ${PRODUCTION_MEDIA_BUCKET}\ncreation_date:  x\n`
      if (key.startsWith('deployments status')) {
        if (opts.worker === 'missing') throw new Error('wrangler falhou')
        return `Version(s):  (100%) ${VERSION}\n`
      }
      if (key.startsWith('versions view'))
        return `env.CMS_MEDIA_PROCESSOR_ENABLED ("${opts.worker ?? 'disabled'}")      Environment Variable\n`
      throw new Error(`comando inesperado: ${key}`)
    }
  const run = (profile: 'media-closed' | 'media-open', opts?: Parameters<typeof fake>[0]) => {
    writeFileSync(join(dir, 'wrangler.jsonc'), read(PROFILES[profile].file))
    return preflight({ dir, env: okEnv, info: okInfo, run: fake(opts), profile })
  }

  it('processorGate lê a versão ativa e a variável do Worker', () => {
    expect(processorGate(fake({ worker: 'enabled' }), okEnv)).toBe('enabled')
    expect(processorGate(fake({ worker: 'disabled' }), okEnv)).toBe('disabled')
  })

  it('media-closed: aprova com bucket e Worker existentes e o Worker fechado', () => {
    expect(run('media-closed', { worker: 'disabled' })).toEqual({ ok: true, problems: [] })
  })

  it('media-closed: bloqueia se o Worker estiver aberto (fechar Pages antes e depois o Worker)', () => {
    expect(run('media-closed', { worker: 'enabled' }).problems.join()).toMatch(
      /fechar o Pages antes/,
    )
  })

  it('media-open: exige o Worker já aberto; com ele aberto aprova', () => {
    expect(run('media-open', { worker: 'disabled' }).problems.join()).toMatch(
      /exige o gate do Worker/,
    )
    expect(run('media-open', { worker: 'enabled' })).toEqual({ ok: true, problems: [] })
  })

  it('bloqueia sem o bucket e sem o Worker', () => {
    expect(run('media-closed', { bucket: false }).problems.join()).toMatch(
      /bucket R2 .* não existe/,
    )
    expect(run('media-closed', { worker: 'missing' }).problems.join()).toMatch(
      /Worker .* não existe/,
    )
  })

  it('o perfil base não faz nenhuma leitura de mídia', () => {
    writeFileSync(join(dir, 'wrangler.jsonc'), read(PROFILES.base.file))
    const seen: string[] = []
    preflight({
      dir,
      env: okEnv,
      info: okInfo,
      run: (args: string[]) => {
        seen.push(args.join(' '))
        return JSON.stringify([{ 'Project Name': 'chopp-delivery-prod' }])
      },
    })
    expect(seen).toEqual(['pages project list --json'])
  })
})

describe('CLI do guard', () => {
  it('recusa perfil desconhecido sem executar nada', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/production-pages-deploy.mjs', 'preflight', '--profile', 'x'],
      {
        encoding: 'utf8',
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/perfil desconhecido/)
  })

  it('preflight e deploy exigem --commit explícito: a constante do último release não aprova o candidato', () => {
    for (const mode of ['preflight', 'deploy']) {
      const result = spawnSync(
        process.execPath,
        ['scripts/production-pages-deploy.mjs', mode, '--dir', tmpdir()],
        {
          encoding: 'utf8',
        },
      )
      expect(result.status, mode).toBe(1)
      expect(result.stderr, mode).toMatch(/--commit deve ser um SHA-1 completo/)
    }
  })
})
