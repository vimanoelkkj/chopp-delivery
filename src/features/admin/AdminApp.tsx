import { useCallback, useEffect, useMemo, useRef } from 'react'
import './admin.css'
import styles from './AdminApp.module.css'
import { AdminShell } from './AdminShell'
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
  // F3B: catálogo mockado. A integração com a F3A.2 troca só esta linha
  // (ver "Passos para conectar" em docs/admin-panel-handoff.md).
  const gateway = useMemo(() => createMockGateway(readMockMode(window.location.search)), [])

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
