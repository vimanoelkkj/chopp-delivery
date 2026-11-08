export const ROOT: string
export const PROJECT_NAME: string
export const PRODUCTION_BRANCH: string
export const COMMERCIAL_COMMIT: string
export const BUILD_DIR: string
export const ADMIN_ORIGIN: string
export const PRODUCTION_CONFIG_SHA256: string
export function deployArgs(commit?: string): string[]
export function checkDeployCommand(argv: string[], options?: { commit?: string }): string[]
export function checkReleaseCommit(commit: unknown, options?: { root?: string }): string[]
export function checkSnapshot(dir: string, options?: { root?: string; commit?: string }): string[]
export function checkDeployDir(
  dir: string | undefined,
  options?: { root?: string; verifySnapshot?: boolean; commit?: string },
): string[]
export function preflight(options?: {
  dir?: string
  env?: Record<string, string | undefined>
  run?: (args: string[], env: Record<string, string | undefined>) => string
  info?: (env: Record<string, string | undefined>) => string
  verifySnapshot?: boolean
  commit?: string
}): { ok: boolean; problems: string[] }
