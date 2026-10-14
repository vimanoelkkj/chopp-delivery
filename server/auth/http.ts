export type AuthSettings = {
  ADMIN_ORIGIN?: string
  ADMIN_PASSWORD_PEPPER?: string
  ADMIN_ALLOW_INSECURE_LOCAL?: string
}

export type AuthEnv = Pick<Env, 'DELEGAS_DB'> & AuthSettings

export type AuthConfig = { origin: string; pepper: string; local: boolean }

export function authConfig(request: Request, env: AuthSettings): AuthConfig {
  const origin = env.ADMIN_ORIGIN ?? ''
  const url = new URL(origin)
  const local =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    env.ADMIN_ALLOW_INSECURE_LOCAL === '1'
  if (
    origin !== url.origin ||
    new URL(request.url).origin !== origin ||
    (!local && url.protocol !== 'https:') ||
    !/^[a-f0-9]{64}$/.test(env.ADMIN_PASSWORD_PEPPER ?? '')
  ) {
    throw new Error('Configuração de autenticação inválida')
  }
  return { origin, pepper: env.ADMIN_PASSWORD_PEPPER ?? '', local }
}

export function validWriteOrigin(request: Request, config: AuthConfig): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (origin !== null) return origin === config.origin
  const referer = request.headers.get('referer')
  if (!referer) return false
  try {
    const url = new URL(referer)
    return url.origin === config.origin && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export function authJson(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  return Response.json(body, { status, headers })
}

export function authError(code: string, status: number, extra: HeadersInit = {}): Response {
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: 'Credenciais inválidas.',
    INVALID_REQUEST: 'Requisição inválida.',
    INVALID_ORIGIN: 'Origem não permitida.',
    UNAUTHENTICATED: 'Autenticação necessária.',
    RATE_LIMITED: 'Muitas tentativas. Aguarde e tente novamente.',
    METHOD_NOT_ALLOWED: 'Método não permitido.',
    AUTH_UNAVAILABLE: 'Autenticação indisponível no momento.',
  }
  return authJson({ error: { code, message: messages[code] } }, status, extra)
}

export function wrongMethod(request: Request, allowed: string): Response {
  const response = authError('METHOD_NOT_ALLOWED', 405, { Allow: allowed })
  return request.method === 'HEAD' ? new Response(null, response) : response
}

export const LOGIN_BODY_TIMEOUT_MS = 5000

export function normalizeUsername(value: string): string | null {
  const username = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(username) ? username.toLowerCase() : null
}

/** Limita bytes reais e duração total da leitura antes de reservar tentativas. */
export async function readLogin(
  request: Request,
): Promise<{ username: string; password: string } | null> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json' ||
    !request.body
  )
    return null
  const reader = request.body.getReader()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Prazo de leitura excedido'))
      void reader.cancel().catch(() => {})
    }, LOGIN_BODY_TIMEOUT_MS)
  })
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      length += value.byteLength
      if (length > 2048) {
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
    const fields = data as Record<string, unknown>
    if (
      Object.keys(fields).length !== 2 ||
      typeof fields.username !== 'string' ||
      typeof fields.password !== 'string'
    )
      return null
    const username = normalizeUsername(fields.username)
    if (
      username === null ||
      [...fields.password].length < 1 ||
      [...fields.password].length > 128 ||
      new TextEncoder().encode(fields.password).length > 512
    )
      return null
    return { username, password: fields.password }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    reader.releaseLock()
  }
}
