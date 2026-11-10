export const ROOT: string
export const TEMPLATE: string
export const HOMOLOGATION_D1_ID: string
export const ACCOUNT_ID: string
export const MAX_WINDOW_MINUTES: number
export const FILE_NAME: string
export const MODES: string[]
export type BootstrapConfigOptions = {
  mode: string
  origin?: string
  d1Id?: string
  username?: string
  windowMinutes?: number
  delayMinutes?: number
  out?: string
}
export type BuiltConfig = {
  // biome-ignore lint/suspicious/noExplicitAny: forma JSON do wrangler, validada pelos testes
  config: any
  command: Record<string, unknown> | null
  cron: string
  expiresAt: number
}
export function buildConfig(options: BootstrapConfigOptions, now?: Date): BuiltConfig
export function writeConfig(
  options: BootstrapConfigOptions,
  now?: Date,
): BuiltConfig & { file: string }
