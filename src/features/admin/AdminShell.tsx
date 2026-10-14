import { useEffect, useState } from 'react'
import { AdminHeader } from './AdminHeader'
import styles from './AdminShell.module.css'
import { CatalogView } from './catalog/CatalogView'
import type { AdminCatalogGateway } from './catalog/gateway'
import type { AdminUser } from './catalog/types'
import { useCatalogEditor } from './catalog/useCatalogEditor'
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
  onExpired: () => void
}

export function AdminShell({ user, gateway, onSignOut, onExpired }: AdminShellProps) {
  const { toast, notify } = useToast()
  const editor = useCatalogEditor(gateway, { onUnauthenticated: onExpired, notify })
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [target, setTarget] = useState<Target>('site')
  const [signingOut, setSigningOut] = useState(false)
  const { dirty } = editor

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
      <main className={styles.main}>
        <CatalogView editor={editor} toast={toast} />
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
