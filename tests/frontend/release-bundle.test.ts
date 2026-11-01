import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, resolveConfig } from 'vite'
import { describe, expect, it } from 'vitest'
import { auditGraph, auditRelease } from '../../scripts/bundle-guard.mjs'

const root = process.cwd()

describe('release: gateway real e isolamento', () => {
  it('inclui AdminApp e HTTP, exclui mock, fixtures e AdminDisabled', async () => {
    const result = await auditGraph({ root, mode: 'release' })
    expect(result.leakedModules).toEqual([])
    expect(result.leakedManifest).toEqual([])
    // O grafo real deve comprovar presença, além de ausência.
    const { collectGraph } = await import('../../scripts/bundle-guard.mjs')
    const graph = await collectGraph({ root, mode: 'release' })
    expect(graph.moduleIds.some((id) => id.includes('/admin/AdminApp.tsx'))).toBe(true)
    expect(graph.moduleIds.some((id) => id.includes('/catalog/httpGateway.ts'))).toBe(true)
    expect(graph.moduleIds.some((id) => /mockGateway|mockData|AdminDisabled/.test(id))).toBe(false)
  }, 120_000)

  it('continua rejeitando o laboratório quando DEV é forçado no release', async () => {
    const result = await auditGraph({
      root,
      mode: 'release',
      define: { 'import.meta.env.DEV': 'true' },
    })
    expect(result.leakedModules.some((id) => id.includes('/pages/preview/'))).toBe(true)
  }, 120_000)

  it('verifica o artefato emitido e rejeita adulteração, arquivos extras, mocks e ausência de HTTP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'delegas-release-test-'))
    const dist = join(directory, 'dist')
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await build({ root, mode: 'release', logLevel: 'silent', build: { outDir: dist } })
      expect((await auditRelease({ root, dir: dist })).problems).toEqual([])
      // Simula arquivo copiado de public/ durante o build: hash correto não o torna permitido.
      const cleanReport = await readFile(`${dist}.audit.json`, 'utf8')
      const fixture = '{"password":"senha local"}'
      await writeFile(join(dist, 'fixtures.json'), fixture)
      const withFixture = JSON.parse(cleanReport)
      withFixture.files['fixtures.json'] = createHash('sha256').update(fixture).digest('hex')
      withFixture.files = Object.fromEntries(
        Object.keys(withFixture.files)
          .sort()
          .map((key) => [key, withFixture.files[key]]),
      )
      await writeFile(`${dist}.audit.json`, JSON.stringify(withFixture))
      const fixtureResult = await auditRelease({ root, dir: dist })
      expect(fixtureResult.problems).not.toContain('Arquivos divergentes do build auditado')
      expect(fixtureResult.problems).toContain('Arquivo proibido: fixtures.json')
      expect(fixtureResult.problems.some((p) => p.includes('senha local'))).toBe(true)
      await rm(join(dist, 'fixtures.json'))
      await writeFile(`${dist}.audit.json`, cleanReport)
      await writeFile(join(dist, 'extra.js'), '/* inclusão posterior */')
      const cli = spawnSync(
        process.execPath,
        [join(root, 'scripts/check-release-bundle.mjs'), dist],
        {
          cwd: root,
          encoding: 'utf8',
          windowsHide: true,
        },
      )
      expect(cli.status).toBe(1)
      expect(cli.stderr).toContain('Arquivos divergentes')
      expect((await auditRelease({ root, dir: dist })).problems).toContain(
        'Arquivos divergentes do build auditado',
      )
      await rm(join(dist, 'extra.js'))
      const index = await readFile(join(dist, 'index.html'), 'utf8')
      await writeFile(join(dist, 'index.html'), `${index}<!-- modificado -->`)
      expect((await auditRelease({ root, dir: dist })).problems).toContain(
        'Arquivos divergentes do build auditado',
      )
      await writeFile(join(dist, 'index.html'), index)
      const reportPath = `${dist}.audit.json`
      const report = JSON.parse(await readFile(reportPath, 'utf8'))
      report.modules.push('src/features/admin/catalog/mockData.ts')
      report.modules = report.modules.filter((id: string) => !id.endsWith('/httpGateway.ts'))
      await writeFile(reportPath, JSON.stringify(report))
      const rejected = await auditRelease({ root, dir: dist })
      expect(rejected.problems.some((p) => p.includes('Módulo proibido:'))).toBe(true)
      expect(rejected.problems.some((p) => p.includes('Módulo obrigatório ausente:'))).toBe(true)
      await rm(reportPath)
      await expect(auditRelease({ root, dir: dist })).rejects.toThrow()
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
      await rm(directory, { recursive: true, force: true })
    }
  }, 120_000)

  it('não expõe VITE_* arbitrário, nem segredo backend, mesmo presente no processo', async () => {
    const previous = process.env.VITE_RELEASE_SECRET_CANARY
    const previousPepper = process.env.ADMIN_PASSWORD_PEPPER
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.VITE_RELEASE_SECRET_CANARY = 'not-a-real-secret'
    process.env.ADMIN_PASSWORD_PEPPER = 'not-a-real-pepper'
    try {
      const config = await resolveConfig({ root, mode: 'release' }, 'build')
      expect(config.env.VITE_RELEASE_SECRET_CANARY).toBeUndefined()
      expect(config.env.ADMIN_PASSWORD_PEPPER).toBeUndefined()
      expect(Object.keys(config.env).filter((key) => key.startsWith('VITE_'))).toEqual([])
      expect(config.define).toHaveProperty('import.meta.env.VITE_WHATSAPP_NUMBER')
    } finally {
      if (previous === undefined) delete process.env.VITE_RELEASE_SECRET_CANARY
      else process.env.VITE_RELEASE_SECRET_CANARY = previous
      if (previousPepper === undefined) delete process.env.ADMIN_PASSWORD_PEPPER
      else process.env.ADMIN_PASSWORD_PEPPER = previousPepper
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('distingue textos JSX compartilhados de expressões TypeScript', async () => {
    const { literalsOf } = await import('../../scripts/bundle-guard.mjs')
    expect(literalsOf('<p>Tentar de novo</p>')).toContain('Tentar de novo')
    expect(
      literalsOf('const wait = (): Promise<void> => new Promise<void>(() => {})', 8, false),
    ).toEqual(new Set())
  })

  it('não aceita release compilado como desenvolvimento', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      await expect(resolveConfig({ root, mode: 'release' }, 'build')).rejects.toThrow(
        'Release exige NODE_ENV=production',
      )
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })
})
