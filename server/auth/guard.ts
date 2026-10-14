import { type AuthEnv, authConfig, authError, validWriteOrigin } from './http'
import { currentAdmin } from './session'

/** Toda rota protegida precisa chamar este guard; origem não substitui sessão. */
export async function requireAdmin(request: Request, env: AuthEnv) {
  try {
    const config = authConfig(request, env)
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !validWriteOrigin(request, config)
    ) {
      return { error: authError('INVALID_ORIGIN', 403) }
    }
    const principal = await currentAdmin(env.DELEGAS_DB, request, config)
    return principal ? { principal, config } : { error: authError('UNAUTHENTICATED', 401) }
  } catch {
    console.error('AUTH_UNAVAILABLE')
    return { error: authError('AUTH_UNAVAILABLE', 503) }
  }
}
