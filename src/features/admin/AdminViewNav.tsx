import { useEffect, useState } from 'react'
import styles from './AdminViewNav.module.css'

/**
 * Telas do painel dentro de /admin. A troca é por fragmento (`#produtos`, `#pagina-inicial`): o
 * hospedeiro só serve /admin e /admin/preview, então não há rota nova no servidor, e voltar/avançar
 * do navegador funciona sozinho.
 */
export type AdminView = 'produtos' | 'pagina-inicial'

const readView = (): AdminView =>
  window.location.hash === '#pagina-inicial' ? 'pagina-inicial' : 'produtos'

export function useAdminView(): AdminView {
  const [view, setView] = useState(readView)
  useEffect(() => {
    const onChange = () => setView(readView())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return view
}

export function AdminViewNav({
  view,
  dirty,
  siteDirty = false,
}: {
  view: AdminView
  dirty: boolean
  siteDirty?: boolean
}) {
  return (
    <nav className={styles.nav} aria-label="Telas do painel">
      <div className={styles.inner}>
        <a
          className={styles.link}
          href="#produtos"
          aria-current={view === 'produtos' ? 'page' : undefined}
        >
          Produtos
          {dirty ? (
            <>
              <span className={styles.dot} aria-hidden="true" />
              <span className="visually-hidden"> (alterações não salvas)</span>
            </>
          ) : null}
        </a>
        <a
          className={styles.link}
          href="#pagina-inicial"
          aria-current={view === 'pagina-inicial' ? 'page' : undefined}
        >
          Página inicial
          {siteDirty ? (
            <>
              <span className={styles.dot} aria-hidden="true" />
              <span className="visually-hidden"> (alterações não salvas)</span>
            </>
          ) : null}
        </a>
      </div>
    </nav>
  )
}
