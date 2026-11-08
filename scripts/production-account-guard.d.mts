export const EXPECTED_ACCOUNT_ID: string
export const PRODUCTION_D1_NAME: string
export const PRODUCTION_D1_ID: string
export const HOMOLOGATION_D1_ID: string
export function checkAccount(options?: {
  env?: Record<string, string | undefined>
  info?: (env: Record<string, string | undefined>) => string
  attempts?: number
  wait?: (ms: number) => void
}): { ok: true } | { ok: false; reason: string }
export function describeFailure(error: unknown): string
