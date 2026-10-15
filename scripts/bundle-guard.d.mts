export const FORBIDDEN_MODULES: RegExp[]
export const FORBIDDEN_TEXT: string[]
export const LAB_SOURCES: string[]
export function scanModules(moduleIds: string[], forbidden?: RegExp[]): string[]
export function literalsOf(source: string, minimum?: number): Set<string>
export function labLiterals(root: string): Promise<string[]>
export function scanDist(
  dir: string,
  options?: { extraText?: string[] },
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
