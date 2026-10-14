import { useEffect, useId, useState } from 'react'
import logo from '@/assets/logo-header.png'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { Container } from '@/shared/ui/Container'
import { navLinks } from '../nav-links'
import styles from './SiteHeader.module.css'

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  return (
    <header className={styles.header}>
      <a className={styles.skip} href="#conteudo">
        Ir para o conteúdo
      </a>
      <Container className={styles.bar}>
        <a href="#topo" className={styles.logo} aria-label="Chopp Delivery Delegas, início">
          <img src={logo} width="112" height="144" alt="" />
        </a>

        <nav className={styles.nav} aria-label="Principal">
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className={styles.bars} aria-hidden="true" />
          </button>
          <ul id={menuId} className={styles.links} data-open={menuOpen}>
            {navLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={styles.link} onClick={() => setMenuOpen(false)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.cta}>
          <WhatsAppButton message="order">Pedir no WhatsApp</WhatsAppButton>
        </div>
      </Container>
    </header>
  )
}
