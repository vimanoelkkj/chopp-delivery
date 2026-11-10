// Gera a configuração TEMPORÁRIA do Worker de bootstrap de produção, fora do repositório.
// Só lê o modelo versionado; não acessa rede, Cloudflare nem credenciais e não aceita senha/pepper.
// Uso: node scripts/production-bootstrap-config.mjs --out <pasta fora do repo> --mode <modo> \
//        --origin https://<origem-de-producao> --d1-id <uuid-do-d1-de-producao> [--username u]
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const TEMPLATE = join(ROOT, 'config/cloudflare/production-bootstrap-worker.jsonc')
export const HOMOLOGATION_D1_ID = 'e5941166-fc42-478b-b007-2c9f44e260b6'
// Conta fixada na configuração gerada: tem precedência sobre CLOUDFLARE_ACCOUNT_ID e sobre o cache.
export const ACCOUNT_ID = '7d8a62a0e64b693184975560c7cb788d'
export const MAX_WINDOW_MINUTES = 60
export const FILE_NAME = 'wrangler.production-bootstrap.jsonc'
// prepare: desarmado, sem cron (primeiro deploy). inspect/bootstrap: armado com um disparo.
// disarm-check: desarmado com um disparo, para observar DISARMED depois de remover os secrets.
export const MODES = ['prepare', 'inspect', 'bootstrap', 'disarm-check']
const ARMED_MODES = ['inspect', 'bootstrap']

const fail = (message) => {
  throw new Error(message)
}

export function buildConfig(options, now = new Date()) {
  const { mode, origin, d1Id, username } = options
  const windowMinutes = options.windowMinutes ?? 30
  const delayMinutes = options.delayMinutes ?? 3
  if (!MODES.includes(mode)) fail(`modo inválido: use ${MODES.join(', ')}`)
  const url = (() => {
    try {
      return new URL(origin)
    } catch {
      return fail('origem inválida')
    }
  })()
  if (
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    /homolog/i.test(url.hostname)
  )
    fail('origem deve ser HTTPS canônica de produção (sem caminho, loopback ou homologação)')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d1Id ?? ''))
    fail('--d1-id deve ser o UUID do D1 de produção')
  if (d1Id === HOMOLOGATION_D1_ID) fail('--d1-id é o da homologação')
  if (
    !Number.isInteger(windowMinutes) ||
    !Number.isInteger(delayMinutes) ||
    windowMinutes < 5 ||
    windowMinutes > MAX_WINDOW_MINUTES ||
    delayMinutes < 2 ||
    windowMinutes < delayMinutes + 3
  )
    fail(`janela 5-${MAX_WINDOW_MINUTES} min, atraso >= 2 min e janela >= atraso + 3`)
  if (mode === 'bootstrap' && !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username ?? ''))
    fail('--username inválido (minúsculas, 3-64 caracteres)')

  const template = JSON.parse(readFileSync(TEMPLATE, 'utf8').replace(/^\s*\/\/.*$/gm, ''))
  const fire = new Date(now.getTime() + delayMinutes * 60_000)
  // Cron do Cloudflare é UTC. Dia e mês fixos: o disparo é único dentro da janela.
  const cron = `${fire.getUTCMinutes()} ${fire.getUTCHours()} ${fire.getUTCDate()} ${fire.getUTCMonth() + 1} *`
  const expiresAt = now.getTime() + windowMinutes * 60_000
  const armed = ARMED_MODES.includes(mode)
  const command = armed
    ? {
        commandId: randomUUID(),
        environment: 'production',
        action: mode,
        origin,
        expiresAt,
        ...(mode === 'bootstrap' ? { username, expectedAuthVersion: 0 } : {}),
      }
    : null
  const config = {
    ...template,
    account_id: ACCOUNT_ID,
    // Caminho absoluto: a cópia fica fora do repositório e `main` relativo não resolveria.
    main: resolve(ROOT, 'server/auth/production-bootstrap-worker.ts'),
    triggers: { crons: armed || mode === 'disarm-check' ? [cron] : [] },
    d1_databases: [{ ...template.d1_databases[0], database_id: d1Id }],
    vars: {
      ...template.vars,
      PRODUCTION_BOOTSTRAP_ENABLED: armed ? 'armed-production-v1' : 'disabled',
      ADMIN_ORIGIN: origin,
      ...(command ? { PRODUCTION_BOOTSTRAP_COMMAND: JSON.stringify(command) } : {}),
    },
  }
  return { config, command, cron, expiresAt }
}

function parseArgs(argv) {
  const known = {
    '--out': 'out',
    '--mode': 'mode',
    '--origin': 'origin',
    '--d1-id': 'd1Id',
    '--username': 'username',
    '--window-minutes': 'windowMinutes',
    '--delay-minutes': 'delayMinutes',
  }
  const result = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = known[argv[i]]
    if (!key || argv[i + 1] === undefined) fail(`argumento desconhecido ou sem valor: ${argv[i]}`)
    result[key] = ['windowMinutes', 'delayMinutes'].includes(key)
      ? Number(argv[i + 1])
      : argv[i + 1]
  }
  return result
}

export function writeConfig(options, now = new Date()) {
  const out = resolve(options.out ?? fail('--out obrigatório'))
  const inside = relative(ROOT, out)
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside)))
    fail('--out deve ficar FORA do repositório')
  const built = buildConfig(options, now)
  mkdirSync(out, { recursive: true })
  const file = join(out, FILE_NAME)
  writeFileSync(file, `${JSON.stringify(built.config, null, 2)}\n`)
  return { file, ...built }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { file, command, cron, expiresAt } = writeConfig(parseArgs(process.argv.slice(2)))
    console.log(`config: ${file}`)
    console.log(`cron (UTC): ${cron}`)
    if (command)
      console.log(`commandId: ${command.commandId}\nexpira: ${new Date(expiresAt).toISOString()}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'falha')
    process.exitCode = 1
  }
}
