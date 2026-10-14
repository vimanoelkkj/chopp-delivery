import type { MouseEvent } from 'react'
import seal from '@/assets/admin-seal.png'
import styles from './AdminHeader.module.css'

type AdminHeaderProps = {
  username: string
  signingOut: boolean
  onSite: (event: MouseEvent<HTMLAnchorElement>) => void
  onLogout: () => void
}

export function AdminHeader({ username, signingOut, onSite, onLogout }: AdminHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <img className={styles.seal} src={seal} width="56" height="56" alt="" />
          <p className={styles.name}>
            Painel <span>Delegas</span>
          </p>
        </div>
        <nav className={styles.nav} aria-label="Painel">
          <a className={styles.site} href="/" onClick={onSite}>
            Ver o site
          </a>
          <span className={styles.user}>{username}</span>
          <button
            type="button"
            className={styles.logout}
            aria-disabled={signingOut || undefined}
            onClick={() => {
              if (!signingOut) onLogout()
            }}
          >
            {signingOut ? 'Saindo…' : 'Sair'}
          </button>
        </nav>
      </div>
    </header>
  )
}
