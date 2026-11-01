export const FORBIDDEN_MODULES: RegExp[]
export const FORBIDDEN_TEXT: string[]
export const LAB_SOURCES: string[]
export function scanModules(moduleIds: string[], forbidden?: RegExp[]): string[]
export function literalsOf(source: string, minimum?: number, jsx?: boolean): Set<string>
export const RELEASE_FORBIDDEN_MODULES: RegExp[]
export const RELEASE_FORBIDDEN_TEXT: string[]
export function labLiterals(root: string, options?: { release?: boolean }): Promise<string[]>
export function scanDist(
  dir: string,
  options?: { extraText?: string[]; forbiddenText?: string[] },
): Promise<{ files: number; hits: { file: string; needle: string }[] }>
export function collectGraph(options?: {
  root?: string
  mode?: string
  define?: Record<string, string>
}): Promise<{ moduleIds: string[]; manifestIds: string[] }>
export function auditGraph(options?: {
  root?: string
  mode?: string
  define?: Record<string, string>
}): Promise<{ modules: number; leakedModules: string[]; leakedManifest: string[] }>
export function releaseAuditPlugin(): import('vite').Plugin
export function auditRelease(options: { root: string; dir?: string }): Promise<{
  problems: string[]
  files: number
  modules: number
  literals: number
}>
