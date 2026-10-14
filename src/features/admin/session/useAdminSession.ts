import { useCallback, useEffect, useState } from 'react'
import type { AdminUser } from '../catalog/types'
import { fetchSession, logout } from './authApi'

export type SessionState =
  | { status: 'checking' }
  | { status: 'unavailable' }
  | { status: 'anonymous'; notice?: string }
  | { status: 'authenticated'; user: AdminUser }

export function useAdminSession() {
  const [state, setState] = useState<SessionState>({ status: 'checking' })
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` reinicia a verificação
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    let active = true
    fetchSession(controller.signal)
      .then((user) => {
        if (active) setState(user ? { status: 'authenticated', user } : { status: 'anonymous' })
      })
      .catch(() => {
        if (active) setState({ status: 'unavailable' })
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      clearTimeout(timeout)
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'checking' })
    setAttempt((value) => value + 1)
  }, [])
  const signedIn = useCallback((user: AdminUser) => setState({ status: 'authenticated', user }), [])
  const expired = useCallback(
    () => setState({ status: 'anonymous', notice: 'Sua sessão expirou. Entre novamente.' }),
    [],
  )
  /** `false` quando o servidor não confirmou a saída: a sessão pode continuar válida. */
  const signOut = useCallback(async () => {
    if (!(await logout())) return false
    setState({ status: 'anonymous' })
    return true
  }, [])

  return { state, retry, signedIn, expired, signOut }
}
