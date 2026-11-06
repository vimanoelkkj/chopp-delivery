import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ADMIN_THEME, useDocumentTheme } from '@/shared/lib/documentTheme'
import { themeAttributes } from '@/shared/lib/theme'
import './admin.css'
import styles from './AdminApp.module.css'
import { AdminShell } from './AdminShell'
import { createHttpGateway } from './catalog/httpGateway'
import { createMockGateway, readMockMode } from './catalog/mockGateway'
import type { Rescue } from './catalog/saveFlow'
import { LoginScreen } from './login/LoginScreen'
import { PreviewShell } from './preview/PreviewShell'
import { useAdminSession } from './session/useAdminSession'
import type { SiteRescue } from './site/HomeEditor'
import { AdminButton } from './ui/AdminButton'
import { BootSplash } from './ui/BootSplash'
import { AdminThemeContext, useAdminTheme } from './useAdminTheme'

/** Página do painel (rota /admin). Carregada sob demanda: o site público não baixa este código. */
export default function AdminApp() {
  const theme = useAdminTheme()
  const mode = theme.mode
  useDocumentTheme(ADMIN_THEME, mode)
  const { state, retry, signedIn, expired, signOut } = useAdminSession()
  // Rascunho guardado só em memória quando a sessão expira no meio da edição (some ao recarregar).
  const rescue = useRef<Rescue | null>(null)
  // O mesmo para a Página inicial: o documento editado fica só em memória até o novo login.
  const siteRescue = useRef<SiteRescue | null>(null)
  const onExpired = useCallback(
    (kept?: Rescue) => {
      rescue.current = kept ?? null
      expired(Boolean(kept) || siteRescue.current !== null)
    },
    [expired],
  )
  const onRescueHandled = useCallback(() => {
    rescue.current = null
  }, [])
  const onSiteRescue = useCallback((kept: SiteRescue) => {
    siteRescue.current = kept
  }, [])
  const onSiteRescueHandled = useCallback(() => {
    siteRescue.current = null
  }, [])
  const signOutAndDiscard = useCallback(async () => {
    const ok = await signOut()
    if (ok) {
      siteRescue.current = null
      rescue.current = null
    }
    return ok
  }, [signOut])
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
    <AdminThemeContext.Provider value={theme}>
      <div {...themeAttributes('admin', mode)} data-admin className={styles.root}>
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
          /^\/admin\/preview\/?$/.test(window.location.pathname) ? (
            <PreviewShell
              username={state.user.username}
              onSignOut={signOutAndDiscard}
              onExpired={onExpired}
            />
          ) : (
            <AdminShell
              user={state.user}
              gateway={gateway}
              onSignOut={signOutAndDiscard}
              onExpired={onExpired}
              rescue={rescue.current}
              onRescueHandled={onRescueHandled}
              siteRescue={siteRescue.current}
              onSiteRescue={onSiteRescue}
              onSiteRescueHandled={onSiteRescueHandled}
            />
          )
        ) : null}
      </div>
    </AdminThemeContext.Provider>
  )
}
