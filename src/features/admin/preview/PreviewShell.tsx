import { useEffect, useRef, useState } from 'react'
import { PREVIEW_FRAME_PATH } from '../../../../shared/preview-security'
import { AdminHeader } from '../AdminHeader'
import styles from './Preview.module.css'
import { PreviewMessage } from './PreviewMessage'
import { usePreviewDocument } from './usePreviewDocument'

const FRAME_HEIGHT = 900

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
  // Em tela estreita a prévia abre no dispositivo móvel: o desktop reduzido a 24% não se lê.
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 47.99rem)').matches)
  const [failure, setFailure] = useState(false)
  const surface = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  useEffect(() => {
    if (state.status === 'expired') onExpired()
  }, [state.status, onExpired])

  // O iframe mantém o viewport real (1440 ou 390 px); em telas menores ele é só reduzido por
  // transform, sem mudar o que a página renderiza e sem rolagem horizontal.
  const ready = state.status === 'ready'
  useEffect(() => {
    const node = surface.current
    if (!ready || !node) return
    const measure = () => {
      const style = getComputedStyle(node)
      setAvailable(
        node.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ready])

  const width = mobile ? 390 : 1440
  const scale = available > 0 ? Math.min(1, available / width) : 1

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
          <div className={styles.surface} ref={surface}>
            <div
              className={styles.stage}
              style={{ width: Math.round(width * scale), height: Math.round(FRAME_HEIGHT * scale) }}
            >
              {/* Trusted same-origin application. This pair does NOT create an origin security boundary.
            Server-side auth, no-store and strict text validation are mandatory independently. */}
              <iframe
                className={styles.frame}
                title="Rascunho CMS v2"
                src={PREVIEW_FRAME_PATH}
                width={width}
                height={FRAME_HEIGHT}
                style={scale < 1 ? { transform: `scale(${scale})` } : undefined}
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        )}
      </main>
    </>
  )
}
