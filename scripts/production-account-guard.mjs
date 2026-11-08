// Guarda de conta/alvo: interrompe o procedimento de produção se a conta efetiva do Wrangler ou o D1
// resolvido não forem os esperados. Somente leitura (`d1 info`); não imprime credenciais.
// Uso: node scripts/production-account-guard.mjs   (exit 0 = conta e D1 de produção confirmados)
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const EXPECTED_ACCOUNT_ID = '7d8a62a0e64b693184975560c7cb788d'
export const PRODUCTION_D1_NAME = 'chopp-delivery-prod-db'
export const PRODUCTION_D1_ID = 'fe4492e3-94a4-4f9a-b44c-10a39fe21bd1'
export const HOMOLOGATION_D1_ID = 'e5941166-fc42-478b-b007-2c9f44e260b6'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Executa o Wrangler instalado com a conta já fixada no ambiente. */
function wranglerInfo(env) {
  return execFileSync(
    process.execPath,
    [
      join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
      'd1',
      'info',
      PRODUCTION_D1_NAME,
      '--json',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 90_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    },
  )
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Causa técnica da falha da leitura, sem segredos: tipo, código e a 1ª linha do stderr, mascarada. */
export function describeFailure(error) {
  const parts = []
  if (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM') parts.push('tempo esgotado')
  else if (typeof error?.status === 'number') parts.push(`wrangler saiu com código ${error.status}`)
  else if (error instanceof SyntaxError) parts.push('resposta do wrangler não é JSON')
  else
    parts.push(error?.code ? `falha ao executar (${error.code})` : 'falha ao executar o wrangler')
  const line = String(error?.stderr ?? '')
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find(Boolean)
  if (line)
    parts.push(
      line
        .replace(/[A-Za-z0-9_-]{32,}/g, '[omitido]')
        .replace(/(token|secret|key|authorization)\S*/gi, '$1 [omitido]')
        .slice(0, 160),
    )
  return parts.join(': ')
}

/** Lê o D1 de produção. Falha transitória (rede, renovação do login) tem uma nova tentativa; uma
 * resposta que identifica outro banco nunca é repetida nem aceita. */
function readD1(info, env, attempts, wait) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const raw = info(env)
      return { ok: true, value: JSON.parse(raw.slice(raw.indexOf('{'))) }
    } catch (error) {
      last = error
      if (attempt < attempts) wait(2000)
    }
  }
  return { ok: false, error: last }
}

/**
 * @param {{ env?: Record<string, string | undefined>, info?: (env: Record<string, string | undefined>) => string, attempts?: number, wait?: (ms: number) => void }} [options]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkAccount({
  env = process.env,
  info = wranglerInfo,
  attempts = 2,
  wait = sleep,
} = {}) {
  // O Pages não lê o account_id da configuração gerada: a variável de ambiente é obrigatória.
  if (env.CLOUDFLARE_ACCOUNT_ID !== EXPECTED_ACCOUNT_ID)
    return { ok: false, reason: 'CLOUDFLARE_ACCOUNT_ID ausente ou diferente da conta esperada' }
  const read = readD1(info, env, attempts, wait)
  if (!read.ok)
    return {
      ok: false,
      reason: `não foi possível ler o D1 de produção na conta informada (${describeFailure(read.error)})`,
    }
  const result = read.value
  if (result?.uuid === HOMOLOGATION_D1_ID)
    return { ok: false, reason: 'o alvo resolvido é o D1 de homologação' }
  if (result?.uuid !== PRODUCTION_D1_ID || result?.name !== PRODUCTION_D1_NAME)
    return { ok: false, reason: 'o D1 resolvido não é o de produção esperado (nome e UUID)' }
  return { ok: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkAccount()
  if (result.ok) console.log('conta e D1 de produção confirmados')
  else {
    console.error(`BLOQUEADO: ${result.reason}`)
    process.exitCode = 1
  }
}
