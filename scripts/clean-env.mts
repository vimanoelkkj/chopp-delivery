// Ambiente mínimo para processos filhos do runtime LOCAL descartável (Wrangler, Miniflare/workerd,
// servidor de teste). Em vez de herdar todo `process.env` do operador (tokens da Cloudflare, chaves
// AWS, segredos de CI...), repassa só o que Windows, Node e o Wrangler precisam, mais o que o
// chamador pedir de forma explícita. É allowlist: variável nova do sistema não passa sozinha.

/** Nomes comparados em maiúsculas (no Windows `Path` e `PATH` são a mesma variável). */
const ALLOWED = new Set([
  // Resolução de executáveis e do sistema (Windows)
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'NUMBER_OF_PROCESSORS',
  'COMPUTERNAME',
  'USERDOMAIN',
  'USERNAME',
  'PUBLIC',
  'ALLUSERSPROFILE',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  // Diretórios temporários, home e configuração/cache do Wrangler
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  // Locale e terminal (sem efeito de segurança)
  'LANG',
  'LC_ALL',
  'TZ',
  'TERM',
  'NO_COLOR',
  'FORCE_COLOR',
])

// NODE_OPTIONS (injeta código), NODE_ENV (decide DEV/produção no build), NODE_PATH, proxies e
// credenciais ficam de fora de propósito. Quem precisar de algo passa em `extra`.

const allowed = (name: string) => ALLOWED.has(name.toUpperCase())

type Env = Record<string, string | undefined>

/** Cópia mínima de `source` + `extra` (valores `undefined` em `extra` são omitidos). */
export function childEnv(extra: Env = {}, source: Env = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(source))
    if (value !== undefined && allowed(name)) env[name] = value
  for (const [name, value] of Object.entries(extra)) if (value !== undefined) env[name] = value
  return env
}

/**
 * Remove de `target` (por padrão o próprio `process.env`) tudo que não está na allowlist nem em
 * `keep`. Usado na entrada dos processos do runtime local: tudo que eles criarem depois (Wrangler,
 * Miniflare, workerd, build do Vite) já nasce sem credenciais herdadas.
 */
export function sanitizeProcessEnv(keep: string[] = [], target: Env = process.env): string[] {
  const kept = new Set(keep.map((name) => name.toUpperCase()))
  const removed: string[] = []
  for (const name of Object.keys(target)) {
    if (allowed(name) || kept.has(name.toUpperCase())) continue
    delete target[name]
    removed.push(name)
  }
  return removed
}

/** Nomes que nunca devem aparecer num filho (usado só nas verificações). */
export const SENSITIVE_NAME =
  /TOKEN|SECRET|PASSWORD|PEPPER|API_?KEY|ACCESS_?KEY|PRIVATE|CREDENTIAL|^AWS_|^CLOUDFLARE|^CF_|^WRANGLER_API|^GITHUB|^NPM_|NODE_OPTIONS|^SSH_/i
