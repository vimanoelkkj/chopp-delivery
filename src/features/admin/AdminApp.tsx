import { useCallback, useEffect, useMemo, useRef } from 'react'
import './admin.css'
import styles from './AdminApp.module.css'
import { AdminShell } from './AdminShell'
import { createHttpGateway } from './catalog/httpGateway'
import { createMockGateway, readMockMode } from './catalog/mockGateway'
import type { Rescue } from './catalog/saveFlow'
import { LoginScreen } from './login/LoginScreen'
import { useAdminSession } from './session/useAdminSession'
import { AdminButton } from './ui/AdminButton'
import { BootSplash } from './ui/BootSplash'

/** Página do painel (rota /admin). Carregada sob demanda: o site público não baixa este código. */
export default function AdminApp() {
  const { state, retry, signedIn, expired, signOut } = useAdminSession()
  // Rascunho guardado só em memória quando a sessão expira no meio da edição (some ao recarregar).
  const rescue = useRef<Rescue | null>(null)
  const onExpired = useCallback(
    (kept?: Rescue) => {
      rescue.current = kept ?? null
      expired(Boolean(kept))
    },
    [expired],
  )
  const onRescueHandled = useCallback(() => {
    rescue.current = null
  }, [])
  // Release e integração não têm fallback: falhas da API permanecem erros.
  const gateway = useMemo(
    () =>
      import.meta.env.MODE === 'release' || import.meta.env.MODE === 'admin-integration'
        ? createHttpGateway()
        : createMockGateway(readMockMode(window.location.search)),
    [],
  )

  useEffect(() => {
    const previous = document.title
    document.title = 'Painel Delegas'
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.append(robots)
    return () => {
      document.title = previous
      robots.remove()
    }
  }, [])

  return (
    <div data-admin className={styles.root}>
      {import.meta.env.MODE !== 'release' && import.meta.env.MODE !== 'admin-integration' ? (
        <p role="note">Modo isolado: o catálogo é fictício e não grava no D1.</p>
      ) : null}
      {state.status === 'checking' ? <BootSplash /> : null}
      {state.status === 'unavailable' ? (
        <main className={styles.unavailable}>
          <p className={styles.eyebrow}>Sem conexão com o painel</p>
          <h1 className={styles.title}>Não conseguimos verificar seu acesso</h1>
          <p className={styles.text}>Tente de novo em instantes.</p>
          <AdminButton onClick={retry}>Tentar de novo</AdminButton>
        </main>
      ) : null}
      {state.status === 'anonymous' ? (
        <LoginScreen notice={state.notice} onSignedIn={signedIn} />
      ) : null}
      {state.status === 'authenticated' ? (
        <AdminShell
          user={state.user}
          gateway={gateway}
          onSignOut={signOut}
          onExpired={onExpired}
          rescue={rescue.current}
          onRescueHandled={onRescueHandled}
        />
      ) : null}
    </div>
  )
}
