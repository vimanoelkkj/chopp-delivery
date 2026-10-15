import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  auditGraph,
  FORBIDDEN_MODULES,
  labLiterals,
  literalsOf,
  scanDist,
  scanModules,
} from '../../scripts/bundle-guard.mjs'

const root = process.cwd()

describe('verify:dist, camada de módulos (padrões)', () => {
  it('acusa laboratório, fixtures, painel e scripts; aceita a landing e o AdminDisabled', () => {
    const ids = [
      'C:\\repo\\src\\pages\\preview\\MotionPreviewPage.tsx',
      '/repo/src/features/catalog-expansion/fixtures.ts',
      '/repo/src/features/admin/AdminApp.tsx',
      '/repo/src/features/admin/catalog/mockGateway.ts',
      '/repo/src/features/motion/TickerMarquee.tsx',
      '/repo/src/pages/landing/sections/HeroRefined.tsx',
      '/repo/scripts/bundle-guard.mjs',
      '/repo/tests/e2e-real/server.mts',
    ]
    expect(scanModules(ids)).toHaveLength(ids.length)
    expect(
      scanModules([
        '/repo/src/pages/landing/LandingPage.tsx',
        '/repo/src/features/catalog-expansion/ExpandableCatalogView.tsx',
        '/repo/src/features/admin/AdminDisabled.tsx',
        '/repo/src/features/admin/AdminDisabled.module.css?inline',
        '/repo/node_modules/react/index.js',
        '\0vite/preload-helper.js',
      ]),
    ).toEqual([])
    expect(FORBIDDEN_MODULES.length).toBeGreaterThan(5)
  })
})

describe('verify:dist, camada de texto', () => {
  const dist = async (files: Record<string, string>) => {
    const base = await realpath(tmpdir())
    const dir = await mkdtemp(join(base, 'delegas-guard-test-'))
    await mkdir(join(dir, 'assets'))
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text)
    return dir
  }

  it('detecta um literal de fixture num dist sintético e passa num limpo', async () => {
    const literals = await labLiterals(root)
    expect(literals).toContain('chope-imperial-stout-oculto')
    const leaky = await dist({ 'assets/a.js': 'x("chope-imperial-stout-oculto")' })
    const clean = await dist({ 'assets/a.js': 'x("catalogo")' })
    try {
      expect((await scanDist(leaky, { extraText: literals })).hits).toHaveLength(1)
      expect((await scanDist(clean, { extraText: literals })).hits).toEqual([])
    } finally {
      await rm(leaky, { recursive: true, force: true })
      await rm(clean, { recursive: true, force: true })
    }
  })

  it('detecta cenários de mock, credenciais e a rota do gateway HTTP', async () => {
    const dir = await dist({
      'assets/a.js': 'a("lost-response");b("/api/admin/catalog/v2");c("senha local")',
    })
    try {
      const { hits } = await scanDist(dir)
      expect(hits.map((hit) => hit.needle).sort()).toEqual([
        '/api/admin/catalog/v2',
        'lost-response',
        'senha local',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('literais de laboratório não incluem frases que o código público também usa', async () => {
    const literals = new Set(await labLiterals(root))
    expect(literals.has('Venda proibida para menores de 18 anos. Beba com moderação.')).toBe(false)
    expect(literalsOf("const a = 'curto'; const b = 'frase longa o bastante'").has('curto')).toBe(
      false,
    )
    expect(literalsOf("const b = 'frase longa o bastante'").has('frase longa o bastante')).toBe(
      true,
    )
  })
})

describe('verify:dist, grafos reais de build (o mecanismo detecta vazamento de verdade)', () => {
  it('build publicável normal: nenhum módulo proibido e manifest limpo', async () => {
    const result = await auditGraph({ root })
    expect(result.modules).toBeGreaterThan(30)
    expect(result.leakedModules).toEqual([])
    expect(result.leakedManifest).toEqual([])
  }, 120_000)

  it('build com o painel ligado (mode e2e): o verificador acusa os módulos do painel', async () => {
    const result = await auditGraph({ root, mode: 'e2e' })
    expect(result.leakedModules.some((id) => id.includes('/src/features/admin/AdminApp'))).toBe(
      true,
    )
    expect(result.leakedModules.some((id) => id.includes('mockGateway'))).toBe(true)
  }, 120_000)

  it('build com o laboratório DEV forçado: acusa MotionPreviewPage e as fixtures', async () => {
    const result = await auditGraph({ root, define: { 'import.meta.env.DEV': 'true' } })
    expect(result.leakedModules.some((id) => id.includes('/src/pages/preview/'))).toBe(true)
    expect(result.leakedModules.some((id) => id.includes('catalog-expansion/fixtures'))).toBe(true)
    expect(result.leakedManifest.length).toBeGreaterThan(0) // e o manifest também enxerga
  }, 120_000)
})
