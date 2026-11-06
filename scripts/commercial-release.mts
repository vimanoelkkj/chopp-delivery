import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, type Plugin, type ResolvedConfig, resolveConfig } from 'vite'
import { normalizeWhatsAppNumber } from '../src/shared/lib/whatsapp.ts'
import { auditRelease } from './bundle-guard.mjs'

const key = 'import.meta.env.VITE_WHATSAPP_NUMBER'
// .env.example and the published-CMS test fixtures. Never commercial destinations.
const demonstrationNumbers = new Set(['5531912345678', '5531999999999', '5532999999999'])

class CommercialConfigError extends Error {}

/** Inspect the actual build replacement, including Vite config/process overrides. */
export function validateCommercialConfig(
  config: Pick<ResolvedConfig, 'mode' | 'isProduction' | 'define'>,
) {
  if (config.mode !== 'release' || !config.isProduction)
    throw new CommercialConfigError(
      'O candidato comercial exige modo release e NODE_ENV=production.',
    )
  let raw: unknown
  try {
    raw = JSON.parse(config.define?.[key] ?? 'null')
  } catch {
    throw new CommercialConfigError('VITE_WHATSAPP_NUMBER deve ser um literal de texto.')
  }
  if (raw === null || raw === '')
    throw new CommercialConfigError('VITE_WHATSAPP_NUMBER obrigatório no candidato comercial.')
  if (typeof raw !== 'string' || normalizeWhatsAppNumber(raw) !== raw)
    throw new CommercialConfigError('VITE_WHATSAPP_NUMBER inválido ou não normalizado.')
  if (demonstrationNumbers.has(raw) || /^(\d)\1+$/.test(raw))
    throw new CommercialConfigError(
      'VITE_WHATSAPP_NUMBER demonstrativo ou placeholder não permitido.',
    )
}

export function commercialGate(): Plugin {
  return {
    name: 'delegas-commercial-gate',
    enforce: 'post',
    configResolved: validateCommercialConfig,
  }
}

export async function commercialRelease({
  root = process.cwd(),
  checkOnly = false,
  outDir = 'dist-commercial',
} = {}) {
  const options = {
    root,
    mode: 'release',
    logLevel: 'silent' as const,
    plugins: [commercialGate()],
    build: { outDir: resolve(root, outDir) },
  }
  if (checkOnly) {
    await resolveConfig(options, 'build')
    return
  }
  // The same gate runs inside the build before emitting any files.
  await build(options)
  const audit = await auditRelease({ root, dir: options.build.outDir })
  if (audit.problems.length)
    throw new CommercialConfigError('Artefato comercial reprovado pela validação de release.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--check'))
      throw new CommercialConfigError('Use sem argumentos para gerar ou --check para validar.')
    process.env.NODE_ENV = 'production'
    await commercialRelease({ checkOnly: process.argv.includes('--check') })
    console.log('Validação comercial aprovada; titularidade e operação exigem aprovação humana.')
  } catch (error) {
    // Never print Vite errors/configuration: they may contain environment values or secrets.
    console.error(
      error instanceof CommercialConfigError ? error.message : 'Falha na validação comercial.',
    )
    process.exitCode = 1
  }
}
