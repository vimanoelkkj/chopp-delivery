import { useEffect, useState } from 'react'
import { PREVIEW_FRAME_PATH } from '../../../../shared/preview-security'
import { AdminHeader } from '../AdminHeader'
import styles from './Preview.module.css'
import { PreviewMessage } from './PreviewMessage'
import { usePreviewDocument } from './usePreviewDocument'

export function PreviewShell({
  username,
  onSignOut,
  onExpired,
}: {
  username: string
  onSignOut: () => Promise<boolean>
  onExpired: () => void
}) {
  const { state, reload } = usePreviewDocument()
  const [mobile, setMobile] = useState(false)
  const [failure, setFailure] = useState(false)
  useEffect(() => {
    if (state.status === 'expired') onExpired()
  }, [state.status, onExpired])
  return (
    <>
      <AdminHeader
        username={username}
        signingOut={false}
        onSite={() => {}}
        onLogout={() => {
          void onSignOut().then((ok) => {
            if (!ok) setFailure(true)
          })
        }}
      />
      <main className={styles.shell}>
        <div className={styles.toolbar} role="toolbar" aria-label="Navegação da prévia">
          <a href="/admin">Catálogo administrativo</a>
          <h1>Prévia editorial</h1>
          <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>
            Desktop · 1440px
          </button>
          <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>
            Mobile · 390px
          </button>
          <button type="button" onClick={reload}>
            Atualizar prévia
          </button>
        </div>
        <p className={styles.notice}>
          Rascunho não publicado · Somente leitura · Ações comerciais desativadas
        </p>
        {failure && <p role="alert">Não foi possível confirmar a saída. Tente novamente.</p>}
        {state.status !== 'ready' ? (
          <PreviewMessage state={state} retry={reload} />
        ) : (
          <div className={styles.surface}>
            {/* Trusted same-origin application. This pair does NOT create an origin security boundary.
            Server-side auth, no-store and strict text validation are mandatory independently. */}
            <iframe
              className={styles.frame}
              title="Rascunho CMS v2"
              src={PREVIEW_FRAME_PATH}
              width={mobile ? 390 : 1440}
              height={900}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
      </main>
    </>
  )
}
