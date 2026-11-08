import { useEffect, useRef, useState } from 'react'
import { AdminHeader } from './AdminHeader'
import styles from './AdminShell.module.css'
import { AdminViewNav, useAdminView } from './AdminViewNav'
import { CatalogView } from './catalog/CatalogView'
import type { AdminCatalogGateway } from './catalog/gateway'
import type { Rescue } from './catalog/saveFlow'
import type { AdminUser } from './catalog/types'
import { useCatalogEditor } from './catalog/useCatalogEditor'
import { CatalogGatewayProvider } from './site/CatalogGatewayContext'
import type { SiteRescue } from './site/HomeEditor'
import { SiteView } from './site/SiteView'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { useToast } from './ui/useToast'

type Target = 'site' | 'logout'

const LEAVE_TEXT: Record<Target, { title: string; text: string; confirm: string }> = {
  site: {
    title: 'Sair do painel?',
    text: 'Há alterações que ainda não foram salvas. Se você abrir o site agora, elas serão perdidas.',
    confirm: 'Abrir o site',
  },
  logout: {
    title: 'Sair sem salvar?',
    text: 'Há alterações que ainda não foram salvas. Se você sair agora, elas serão perdidas.',
    confirm: 'Sair sem salvar',
  },
}

type AdminShellProps = {
  user: AdminUser
  gateway: AdminCatalogGateway
  onSignOut: () => Promise<boolean>
  onExpired: (rescue?: Rescue) => void
  rescue?: Rescue | null
  onRescueHandled?: () => void
  /** Alterações da Página inicial guardadas só em memória se a sessão expira durante a edição. */
  siteRescue?: SiteRescue | null
  onSiteRescue?: (rescue: SiteRescue) => void
  onSiteRescueHandled?: () => void
}

export function AdminShell({
  user,
  gateway,
  onSignOut,
  onExpired,
  rescue,
  onRescueHandled,
  siteRescue = null,
  onSiteRescue = () => {},
  onSiteRescueHandled = () => {},
}: AdminShellProps) {
  const { toast, notify } = useToast()
  const editor = useCatalogEditor(gateway, {
    onUnauthenticated: onExpired,
    notify,
    rescue,
    onRescueHandled,
    userId: user.id,
  })
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [target, setTarget] = useState<Target>('site')
  const [signingOut, setSigningOut] = useState(false)
  const [siteDirty, setSiteDirty] = useState(false)
  // Qualquer tela com alterações não salvas protege a saída da página, do painel e do site.
  const dirty = editor.dirty || siteDirty
  // As duas telas ficam montadas depois de abertas e só uma aparece: trocar de tela não perde as
  // alterações não salvas do catálogo (o beforeunload e a confirmação de saída seguem valendo).
  const view = useAdminView()
  const [siteOpened, setSiteOpened] = useState(view === 'pagina-inicial')
  const shownView = useRef(view)
  useEffect(() => {
    if (view === 'pagina-inicial') setSiteOpened(true)
    // Ao trocar de tela, o foco vai para o título dela (leitor de tela e teclado). Comparar com a
    // tela já mostrada evita focar no carregamento inicial, inclusive no StrictMode do dev.
    if (shownView.current === view) return
    shownView.current = view
    requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>(`[data-view="${view}"] h1`)
      heading?.setAttribute('tabindex', '-1')
      heading?.focus()
    })
  }, [view])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const proceed = async (to: Target) => {
    if (to === 'site') {
      window.location.assign('/')
      return
    }
    setSigningOut(true)
    if (!(await onSignOut())) {
      setSigningOut(false)
      notify('error', 'Não foi possível sair agora. Tente de novo.')
    }
  }

  const request = (to: Target) => {
    if (!dirty) return proceed(to)
    setTarget(to)
    setLeaveOpen(true)
  }

  const leave = LEAVE_TEXT[target]
  return (
    <div className={styles.shell}>
      <AdminHeader
        username={user.username}
        signingOut={signingOut}
        onSite={(event) => {
          if (!dirty) return
          event.preventDefault()
          request('site')
        }}
        onLogout={() => request('logout')}
      />
      <AdminViewNav view={view} dirty={editor.dirty} siteDirty={siteDirty} />
      <main className={styles.main}>
        <div data-view="produtos" hidden={view !== 'produtos'} className={styles.view}>
          <CatalogView editor={editor} toast={toast} />
        </div>
        {siteOpened ? (
          <div
            data-view="pagina-inicial"
            hidden={view !== 'pagina-inicial'}
            className={styles.view}
          >
            <CatalogGatewayProvider value={gateway}>
              <SiteView
                userId={user.id}
                onExpired={() => {
                  const { load, draft } = editor.state
                  onExpired(
                    editor.dirty && draft && load.status === 'ready'
                      ? { draft, revision: load.saved.revision, userId: user.id }
                      : undefined,
                  )
                }}
                rescue={siteRescue}
                onRescue={onSiteRescue}
                onRescueHandled={onSiteRescueHandled}
                onDirtyChange={setSiteDirty}
              />
            </CatalogGatewayProvider>
          </div>
        ) : null}
      </main>
      <ConfirmDialog
        open={leaveOpen}
        title={leave.title}
        confirmLabel={leave.confirm}
        cancelLabel="Continuar editando"
        onCancel={() => setLeaveOpen(false)}
        onConfirm={() => {
          setLeaveOpen(false)
          proceed(target)
        }}
      >
        {leave.text}
      </ConfirmDialog>
    </div>
  )
}
