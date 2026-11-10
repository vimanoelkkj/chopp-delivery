import { type BootstrapStage, bootstrapOwner } from './bootstrap'
import { authConfig } from './http'

/**
 * Criação do primeiro administrador de PRODUÇÃO. Entrada agendada apenas: sem fetch, rota ou
 * workers.dev. Reutiliza o núcleo `bootstrapOwner` (política de senha, PBKDF2/HMAC e inserção
 * singleton atômica) e não herda nada do Worker de manutenção da homologação: variáveis, secrets,
 * nome de ambiente e valor de armamento são próprios, então a configuração de um não arma o outro.
 *
 * Fica inerte salvo se, simultaneamente: armado com o valor próprio, ambiente `production`, comando
 * versionado ainda dentro de uma janela curta (`expiresAt`), origem do comando igual a `ADMIN_ORIGIN`,
 * banco com as migrations esperadas e sem administrador. Nunca recupera nem altera conta.
 */
export type ProductionBootstrapEnv = {
  DELEGAS_DB?: D1Database
  PRODUCTION_BOOTSTRAP_ENABLED?: string
  PRODUCTION_BOOTSTRAP_ENVIRONMENT?: string
  PRODUCTION_BOOTSTRAP_COMMAND?: string
  PRODUCTION_BOOTSTRAP_PASSWORD?: string
  ADMIN_ORIGIN?: string
  ADMIN_PASSWORD_PEPPER?: string
  // Presença de qualquer um destes é configuração de outro ambiente: recusa.
  ADMIN_ALLOW_INSECURE_LOCAL?: string
  CMS_MEDIA_LOCAL?: string
  CMS_MEDIA_ENABLED?: string
  CMS_MEDIA_ENVIRONMENT?: string
  CMS_MEDIA_BUCKET?: unknown
  CMS_MEDIA_PROCESSOR?: unknown
  MAINTENANCE_ENABLED?: string
  MAINTENANCE_ENVIRONMENT?: string
  MAINTENANCE_COMMAND?: string
  MAINTENANCE_PASSWORD?: string
}

export const ARMED = 'armed-production-v1'
/** Janela máxima entre a hora do disparo e `expiresAt`: a operação é supervisionada e curta. */
export const MAX_WINDOW_MS = 60 * 60 * 1000
/** Migrations que o schema de produção precisa ter aplicado antes de criar o proprietário. */
const REQUIRED_MIGRATIONS = ['0003_admin_auth.sql', '0012_cms_publication.sql']

type Stage =
  | BootstrapStage
  | 'arming'
  | 'environment'
  | 'origin'
  | 'command'
  | 'window'
  | 'database'
  | 'password_presence'
  | 'auth_config'
  | 'bootstrap'
  | 'inspect'

type Command = {
  commandId: string
  environment: 'production'
  origin: string
  expiresAt: number
} & ({ action: 'inspect' } | { action: 'bootstrap'; username: string; expectedAuthVersion: 0 })

class Refused extends Error {}
const refuse = (): never => {
  throw new Refused('REFUSED')
}

function commandOf(raw: string): Command {
  if (raw.length > 2048) return refuse()
  const value = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return refuse()
  const keys = [
    'commandId',
    'environment',
    'action',
    'origin',
    'expiresAt',
    ...(value.action === 'bootstrap' ? ['username', 'expectedAuthVersion'] : []),
  ]
  if (
    Object.keys(value).sort().join(',') !== keys.sort().join(',') ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.commandId,
    ) ||
    value.environment !== 'production' ||
    !['bootstrap', 'inspect'].includes(value.action) ||
    typeof value.origin !== 'string' ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.action === 'bootstrap' &&
      (typeof value.username !== 'string' || value.expectedAuthVersion !== 0))
  )
    return refuse()
  return value as Command
}

/** HTTPS canônico, fora de loopback e fora de qualquer origem de homologação. */
function productionOrigin(raw: string | undefined): string {
  if (!raw) return refuse()
  const url = new URL(raw)
  if (
    url.protocol !== 'https:' ||
    url.origin !== raw ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    /homolog/i.test(url.hostname)
  )
    return refuse()
  return raw
}

async function ownerState(db: D1Database) {
  const rows = await db
    .prepare('SELECT id, username, active, auth_version FROM admin_users LIMIT 2')
    .all<{ id: string; username: string; active: number; auth_version: number }>()
  if (rows.success !== true || !Array.isArray(rows.results) || rows.results.length > 1)
    return refuse()
  return rows.results[0] ?? null
}

// Entrada agendada apenas. Sem rota, sem fetch, sem preview, sem gatilho persistente.
export default {
  async scheduled(
    event: Pick<ScheduledController, 'noRetry'>,
    env: ProductionBootstrapEnv,
  ): Promise<void> {
    event.noRetry()
    if (env.PRODUCTION_BOOTSTRAP_ENABLED !== ARMED) {
      // Prova de desarmamento observável: nenhuma leitura de banco, comando ou segredo.
      console.info('PRODUCTION_BOOTSTRAP', { result: 'DISARMED' })
      return
    }
    let commandId: string | undefined
    let stage: Stage = 'environment'
    try {
      if (
        env.PRODUCTION_BOOTSTRAP_ENVIRONMENT !== 'production' ||
        !env.DELEGAS_DB ||
        [
          env.ADMIN_ALLOW_INSECURE_LOCAL,
          env.CMS_MEDIA_LOCAL,
          env.CMS_MEDIA_ENABLED,
          env.CMS_MEDIA_ENVIRONMENT,
          env.CMS_MEDIA_BUCKET,
          env.CMS_MEDIA_PROCESSOR,
          env.MAINTENANCE_ENABLED,
          env.MAINTENANCE_ENVIRONMENT,
          env.MAINTENANCE_COMMAND,
          env.MAINTENANCE_PASSWORD,
        ].some((value) => value !== undefined)
      )
        return refuse()
      stage = 'origin'
      const origin = productionOrigin(env.ADMIN_ORIGIN)
      stage = 'command'
      const command = commandOf(env.PRODUCTION_BOOTSTRAP_COMMAND ?? '')
      commandId = command.commandId
      if (command.origin !== origin) return refuse()
      stage = 'window'
      const remaining = command.expiresAt - Date.now()
      if (remaining <= 0 || remaining > MAX_WINDOW_MS) return refuse()

      const db = env.DELEGAS_DB
      stage = 'database'
      const migrations = await db
        .prepare(
          `SELECT count(*) AS n FROM d1_migrations WHERE name IN (${REQUIRED_MIGRATIONS.map(() => '?').join(',')})`,
        )
        .bind(...REQUIRED_MIGRATIONS)
        .first<{ n: number }>()
      if (migrations?.n !== REQUIRED_MIGRATIONS.length) return refuse()

      if (command.action === 'inspect') {
        stage = 'inspect'
        const owner = await ownerState(db)
        console.info('PRODUCTION_BOOTSTRAP', {
          commandId,
          result: 'INSPECTED',
          armed: true,
          owner: owner
            ? {
                username: owner.username,
                active: owner.active === 1,
                authVersion: owner.auth_version,
              }
            : null,
        })
        return
      }

      if ((await ownerState(db)) !== null) {
        console.info('PRODUCTION_BOOTSTRAP', { commandId, result: 'NOT_APPLIED' })
        return
      }
      stage = 'password_presence'
      if (!env.PRODUCTION_BOOTSTRAP_PASSWORD) return refuse()
      stage = 'auth_config'
      authConfig(new Request(origin), env)
      stage = 'bootstrap'
      const applied = await bootstrapOwner(
        db,
        command.username,
        env.PRODUCTION_BOOTSTRAP_PASSWORD,
        env.ADMIN_PASSWORD_PEPPER ?? '',
        (current) => {
          stage = current
        },
      )
      console.info('PRODUCTION_BOOTSTRAP', {
        commandId,
        result: applied ? 'APPLIED' : 'NOT_APPLIED',
      })
    } catch {
      // Nunca serializa erro, ambiente, senha nem pepper: só a etapa fixa.
      console.error('PRODUCTION_BOOTSTRAP', {
        ...(commandId ? { commandId } : {}),
        result: 'REFUSED_OR_UNCONFIRMED',
        stage,
      })
    }
  },
}
