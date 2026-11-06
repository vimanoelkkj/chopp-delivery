import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { childEnv } from '../../scripts/clean-env.mts'
import {
  commercialGate,
  commercialRelease,
  validateCommercialConfig,
} from '../../scripts/commercial-release.mts'

const root = process.cwd()
const valid = '5532987654321' // Synthetic test data, not an approved commercial destination.
const config = (value: unknown) => ({
  mode: 'release',
  isProduction: true,
  define: { 'import.meta.env.VITE_WHATSAPP_NUMBER': JSON.stringify(value) },
})
afterEach(() => vi.unstubAllEnvs())

describe('gate comercial explícito', () => {
  it('aceita um número normalizado pelo fluxo existente', () => {
    expect(() => validateCommercialConfig(config(valid))).not.toThrow()
  })

  it.each([undefined, null, ''])('recusa número ausente: %s', (value) => {
    expect(() => validateCommercialConfig(config(value))).toThrow('obrigatório')
  })

  it.each(['12345', '1234567890123456', '(32) 98765-4321', '32987654321', `secret-${valid}`])(
    'recusa número inválido ou não normalizado sem imprimir o valor (%#)',
    (value) => {
      expect(() => validateCommercialConfig(config(value))).toThrow('inválido ou não normalizado')
    },
  )

  it.each(['5531912345678', '5531999999999', '5532999999999', '000000000000', '111111111111'])(
    'recusa exemplos e placeholders mesmo com tamanho aceito (%#)',
    (value) => {
      expect(() => validateCommercialConfig(config(value))).toThrow('demonstrativo ou placeholder')
    },
  )

  it('recusa expressões e modo incorreto, sem avaliar nem revelar o define', () => {
    expect(() => validateCommercialConfig({ ...config(valid), mode: 'homologation' })).toThrow(
      'modo release',
    )
    expect(() => validateCommercialConfig({ ...config(valid), isProduction: false })).toThrow(
      'NODE_ENV',
    )
    expect(() =>
      validateCommercialConfig({
        ...config(valid),
        define: { 'import.meta.env.VITE_WHATSAPP_NUMBER': 'process.env.SECRET' },
      }),
    ).toThrow('literal de texto')
  })

  it('valida o define final mesmo quando diverge da variável do processo', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VITE_WHATSAPP_NUMBER', valid)
    await expect(
      resolveConfig(
        {
          root,
          mode: 'release',
          logLevel: 'silent',
          plugins: [commercialGate()],
          define: config('5531999999999').define,
        },
        'build',
      ),
    ).rejects.toThrow('demonstrativo')
    vi.stubEnv('VITE_WHATSAPP_NUMBER', '')
    await expect(
      resolveConfig(
        {
          root,
          mode: 'release',
          logLevel: 'silent',
          plugins: [commercialGate()],
          define: config(valid).define,
        },
        'build',
      ),
    ).resolves.toHaveProperty('mode', 'release')
  })

  it('mantém builds normais, previews e release de homologação sem gate', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VITE_WHATSAPP_NUMBER', '')
    for (const mode of ['production', 'e2e', 'homologation', 'release']) {
      const resolved = await resolveConfig({ root, mode, logLevel: 'silent' }, 'build')
      expect(resolved.plugins.some((plugin) => plugin.name === 'delegas-commercial-gate')).toBe(
        false,
      )
    }
  })

  it('CLI usa .env.release.local e prioridade do processo; ignora .env.homologation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chopp-commercial-env-'))
    const cli = join(root, 'scripts/commercial-release.mts')
    const run = (extra: Record<string, string | undefined> = {}, args = ['--check']) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: dir,
        windowsHide: true,
        encoding: 'utf8',
        env: childEnv({ NODE_ENV: 'production', ...extra }),
      })
    try {
      await writeFile(
        join(dir, 'vite.config.mts'),
        `export { default } from ${JSON.stringify(join(root, 'vite.config.ts').replaceAll('\\', '/'))}`,
      )
      await writeFile(join(dir, '.env'), `VITE_WHATSAPP_NUMBER=${valid}\n`)
      await writeFile(join(dir, '.env.homologation'), `VITE_WHATSAPP_NUMBER=${valid}\n`)
      await writeFile(join(dir, '.env.release'), 'VITE_WHATSAPP_NUMBER=5531912345678\n')
      await writeFile(join(dir, '.env.release.local'), 'VITE_WHATSAPP_NUMBER=\n')
      const absent = run()
      expect(absent.status).toBe(1)
      expect(absent.stderr).toContain('obrigatório')
      await writeFile(join(dir, '.env.release.local'), `VITE_WHATSAPP_NUMBER=${valid}\n`)
      expect(run().status).toBe(0)
      const sensitive = `PRIVATE-CANARY-${valid}`
      const failed = run({ VITE_WHATSAPP_NUMBER: sensitive })
      expect(failed.status).toBe(1)
      expect(failed.stderr).toContain('inválido ou não normalizado')
      expect(failed.stdout + failed.stderr).not.toContain(sensitive)
      expect(failed.stdout + failed.stderr).not.toContain(valid)
      const failedBuild = run({ VITE_WHATSAPP_NUMBER: '' }, [])
      expect(failedBuild.status).toBe(1)
      expect(await readdir(dir)).not.toContain('dist-commercial')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('gera e audita um candidato com o mesmo valor incorporado, em saída isolada', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chopp-commercial-build-'))
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VITE_WHATSAPP_NUMBER', valid)
    try {
      const outDir = join(dir, 'candidate')
      await commercialRelease({ root, outDir })
      const files = await readdir(join(outDir, 'assets'))
      const javascript = await Promise.all(
        files
          .filter((file) => file.endsWith('.js'))
          .map((file) => readFile(join(outDir, 'assets', file), 'utf8')),
      )
      expect(javascript.some((text) => text.includes(valid))).toBe(true)
      expect(JSON.parse(await readFile(`${outDir}.audit.json`, 'utf8')).mode).toBe('release')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
