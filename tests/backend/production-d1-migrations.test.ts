import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Preparação das migrations de produção. Tudo local: o Wrangler roda com --local e --persist-to
// numa pasta temporária. Nenhum comando remoto é executado por este arquivo.
const PROD_UUID = 'fe4492e3-94a4-4f9a-b44c-10a39fe21bd1'
const HOMOLOGATION_UUID = 'e5941166-fc42-478b-b007-2c9f44e260b6'
const ROOT = resolve('.')
const doc = readFileSync('docs/production-d1-migrations.md', 'utf8')
const wrangler = (args: string[]) =>
  execFileSync(process.execPath, [join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  })
const files = readdirSync('migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
const blocks = [...doc.matchAll(/```powershell\r?\n([\s\S]*?)```/g)].map((m) => m[1])
const lines = blocks
  .join('\n')
  .split(/\r?\n/)
  .filter((line) => line.includes('npx wrangler '))

describe('configuração exclusiva de produção', () => {
  const raw = readFileSync('wrangler.production.jsonc', 'utf8')
  const config = JSON.parse(raw)

  it('liga DELEGAS_DB ao D1 de produção e nada mais', () => {
    expect(config.name).toBe('chopp-delivery-prod')
    expect(config.d1_databases).toEqual([
      {
        binding: 'DELEGAS_DB',
        database_name: 'chopp-delivery-prod-db',
        database_id: PROD_UUID,
        migrations_dir: 'migrations',
      },
    ])
    expect(config.r2_buckets).toEqual([])
    expect(config.services).toEqual([])
    expect(config.env.preview).toEqual({
      d1_databases: [],
      vars: {},
      r2_buckets: [],
      services: [],
    })
    expect(config.vars).toEqual({ ADMIN_ORIGIN: 'https://chopp-delivery-prod.pages.dev' })
  })

  it('não contém o D1, a origem nem o gate de mídia da homologação', () => {
    expect(raw).not.toContain(HOMOLOGATION_UUID)
    expect(raw).not.toMatch(/homolog|CMS_MEDIA|MEDIA_BUCKET|MEDIA_PROCESSOR|processor/i)
  })
})

describe('migrations 0001-0012', () => {
  it('têm numeração contígua e nomes que o ledger registrará', () => {
    expect(files).toHaveLength(12)
    expect(files.map((file) => file.slice(0, 4))).toEqual(
      files.map((_, index) => String(index + 1).padStart(4, '0')),
    )
    expect(files.at(-1)).toBe('0012_cms_publication.sql')
  })
})

describe('procedimento documentado', () => {
  it('toda escrita remota passa pelo apply oficial com a configuração de produção', () => {
    const remote = lines.filter((line) => line.includes('--remote'))
    expect(remote.length).toBeGreaterThan(3)
    for (const line of remote) {
      expect(line).toMatch(/d1 (info|execute|export|migrations apply)/)
      if (line.includes('d1 execute')) {
        expect(line).toMatch(/--command "SELECT /)
        expect(line).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA)\b/i)
      }
    }
    const apply = lines.filter((line) => line.includes('migrations apply'))
    expect(apply).toEqual([
      'npx wrangler d1 migrations apply DELEGAS_DB --remote --config wrangler.production.jsonc',
    ])
    // `migrations list` cria d1_migrations (escrita): nunca como comando.
    expect(lines.some((line) => line.includes('migrations list'))).toBe(false)
    expect(doc).toContain(PROD_UUID)
  })

  it('subcomandos e flags existem no Wrangler instalado', () => {
    const known = [
      'd1 time-travel restore',
      'd1 time-travel info',
      'd1 migrations apply',
      'd1 execute',
      'd1 export',
      'd1 info',
    ]
    const help = new Map<string, string>()
    for (const line of lines) {
      const tail = line.slice(line.indexOf('npx wrangler ') + 'npx wrangler '.length)
      const command = known.find((c) => tail.startsWith(`${c} `))
      expect(command, line).toBeDefined()
      if (!help.has(command as string))
        help.set(command as string, wrangler([...(command as string).split(' '), '--help']))
      for (const flag of tail.split(/\s+/).filter((w) => /^--[a-z-]+(=|$)/.test(w)))
        expect(help.get(command as string), `${flag} em ${line}`).toContain(flag.split('=')[0])
    }
  }, 240_000)
})

describe('aplicação local descartável com o mecanismo oficial', () => {
  it('aplica 0001-0012 e satisfaz exatamente a pós-verificação documentada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chopp-prod-d1-'))
    try {
      const base = ['--local', '--persist-to', dir, '--config', 'wrangler.production.jsonc']
      const applied = wrangler(['d1', 'migrations', 'apply', 'DELEGAS_DB', ...base])
      for (const file of files) expect(applied).toContain(file)

      const query = (sql: string) => {
        const out = wrangler(['d1', 'execute', 'DELEGAS_DB', ...base, '--json', '--command', sql])
        return JSON.parse(out.slice(out.indexOf('[')))[0].results
      }
      // O SQL é o mesmo do runbook (só troca o alvo remoto pelo local).
      const post = lines.find((line) => line.includes('AS migrations'))
      const sql = /--command "([^"]+)"/.exec(post ?? '')?.[1]
      expect(sql).toBeDefined()
      expect(query(sql as string)).toEqual([
        {
          migrations: 12,
          products: 8,
          cachaca: 1,
          itens: 9,
          variantes: 17,
          admins: 0,
          pronto: 1,
          versoes_cms: 0,
          guards: 0,
        },
      ])
      expect(
        query('SELECT name FROM d1_migrations ORDER BY id').map((r: { name: string }) => r.name),
      ).toEqual(files)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 280_000)
})
