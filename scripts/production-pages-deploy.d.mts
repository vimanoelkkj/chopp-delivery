export const ROOT: string
export const PROJECT_NAME: string
export const PRODUCTION_BRANCH: string
export const COMMERCIAL_COMMIT: string
export const BUILD_DIR: string
export const ADMIN_ORIGIN: string
export const PRODUCTION_CONFIG_SHA256: string
export const PRODUCTION_MEDIA_BUCKET: string
export const PRODUCTION_MEDIA_PROCESSOR: string
export type Profile = 'base' | 'media-closed' | 'media-open'
export const PROFILES: Record<
  Profile,
  { file: string; sha256: string; gate: 'disabled' | 'enabled' | null }
>
export function deployArgs(commit?: string): string[]
export function checkDeployCommand(argv: string[], options?: { commit?: string }): string[]
export function checkReleaseCommit(commit: unknown, options?: { root?: string }): string[]
export function checkSnapshot(dir: string, options?: { root?: string; commit?: string }): string[]
export function checkDeployDir(
  dir: string | undefined,
  options?: { root?: string; verifySnapshot?: boolean; commit?: string; profile?: Profile },
): string[]
export function processorGate(
  run: (args: string[], env: Record<string, string | undefined>) => string,
  env: Record<string, string | undefined>,
): string | null
export function preflight(options?: {
  dir?: string
  env?: Record<string, string | undefined>
  run?: (args: string[], env: Record<string, string | undefined>) => string
  info?: (env: Record<string, string | undefined>) => string
  verifySnapshot?: boolean
  commit?: string
  profile?: Profile
}): { ok: boolean; problems: string[] }
