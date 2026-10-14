import { useEffect, useMemo } from 'react'
import './admin.css'
import styles from './AdminApp.module.css'
import { AdminShell } from './AdminShell'
import { createMockGateway, readMockMode } from './catalog/mockGateway'
import { LoginScreen } from './login/LoginScreen'
import { useAdminSession } from './session/useAdminSession'
import { AdminButton } from './ui/AdminButton'
import { BootSplash } from './ui/BootSplash'

/** Página do painel (rota /admin). Carregada sob demanda: o site público não baixa este código. */
export default function AdminApp() {
  const { state, retry, signedIn, expired, signOut } = useAdminSession()
  // F3B: catálogo mockado. A integração da F3A troca só esta linha (ver docs/admin-panel-ui.md).
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
        <AdminShell user={state.user} gateway={gateway} onSignOut={signOut} onExpired={expired} />
      ) : null}
    </div>
  )
}
