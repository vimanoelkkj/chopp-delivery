import { bootstrapOwner } from './bootstrap'
import { authConfig } from './http'
import { recoverOwnerCredentials } from './recovery'

export type MaintenanceEnv = {
  DELEGAS_DB?: D1Database
  MAINTENANCE_ENVIRONMENT?: string
  MAINTENANCE_ENABLED?: string
  MAINTENANCE_COMMAND?: string
  MAINTENANCE_PASSWORD?: string
  ADMIN_ORIGIN?: string
  ADMIN_PASSWORD_PEPPER?: string
  ADMIN_ALLOW_INSECURE_LOCAL?: string
  CMS_MEDIA_LOCAL?: string
}
type Command = {
  commandId: string
  environment: 'homologation'
  action: 'bootstrap' | 'recover'
  username: string
  expectedAuthVersion: number
  ownerId?: string
}
function commandOf(raw: string): Command {
  if (raw.length > 2048) throw new Error('INVALID_COMMAND')
  const value = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_COMMAND')
  const fields = [
    'commandId',
    'environment',
    'action',
    'username',
    'expectedAuthVersion',
    ...(value.action === 'recover' ? ['ownerId'] : []),
  ]
  if (
    Object.keys(value).sort().join(',') !== fields.sort().join(',') ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.commandId,
    ) ||
    value.environment !== 'homologation' ||
    !['bootstrap', 'recover'].includes(value.action) ||
    typeof value.username !== 'string' ||
    !Number.isSafeInteger(value.expectedAuthVersion) ||
    (value.action === 'bootstrap'
      ? value.expectedAuthVersion !== 0
      : value.expectedAuthVersion < 1) ||
    (value.action === 'recover' && typeof value.ownerId !== 'string')
  )
    throw new Error('INVALID_COMMAND')
  return value as Command
}

// Separate scheduled-only entry point. No import from Pages Functions or the public app.
export default {
  async scheduled(event: Pick<ScheduledController, 'noRetry'>, env: MaintenanceEnv): Promise<void> {
    event.noRetry()
    if (env.MAINTENANCE_ENABLED !== 'armed-v1') return
    let commandId: string | undefined
    try {
      if (
        env.MAINTENANCE_ENVIRONMENT !== 'homologation' ||
        env.ADMIN_ALLOW_INSECURE_LOCAL !== undefined ||
        env.CMS_MEDIA_LOCAL !== undefined ||
        !env.DELEGAS_DB ||
        !env.MAINTENANCE_PASSWORD ||
        !env.ADMIN_ORIGIN
      )
        throw new Error('INVALID_ENVIRONMENT')
      const origin = new URL(env.ADMIN_ORIGIN)
      if (
        origin.protocol !== 'https:' ||
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
      )
        throw new Error('INVALID_ENVIRONMENT')
      authConfig(new Request(env.ADMIN_ORIGIN), env)
      const command = commandOf(env.MAINTENANCE_COMMAND ?? '')
      commandId = command.commandId
      const applied =
        command.action === 'bootstrap'
          ? await bootstrapOwner(
              env.DELEGAS_DB,
              command.username,
              env.MAINTENANCE_PASSWORD,
              env.ADMIN_PASSWORD_PEPPER ?? '',
            )
          : await recoverOwnerCredentials(
              env.DELEGAS_DB,
              {
                ownerId: command.ownerId ?? '',
                username: command.username,
                expectedAuthVersion: command.expectedAuthVersion,
                password: env.MAINTENANCE_PASSWORD,
              },
              env.ADMIN_PASSWORD_PEPPER ?? '',
            )
      console.info('ADMIN_MAINTENANCE', { commandId, result: applied ? 'APPLIED' : 'NOT_APPLIED' })
    } catch {
      // Never serialize errors, environment, request data, passwords or the pepper.
      console.error('ADMIN_MAINTENANCE', {
        ...(commandId ? { commandId } : {}),
        result: 'UNCONFIRMED',
      })
    }
  },
}
