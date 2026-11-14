import { type Ref, useEffect, useId, useState } from 'react'
import logo from '@/assets/logo-header.png'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { Container } from '@/shared/ui/Container'
import { CMS_DEFAULT_DELIVERY_REGION } from '../../../../shared/cms/v2'
import { navLinks } from '../nav-links'
import styles from './SiteHeader.module.css'
import { StorefrontThemeSwitcher } from './StorefrontThemeSwitcher'

export function SiteHeader({
  links = navLinks,
  deliveryRegion = CMS_DEFAULT_DELIVERY_REGION,
  headerRef,
}: {
  headerRef?: Ref<HTMLElement>
  links?: readonly { href: string; label: string }[]
  deliveryRegion?: string
} = {}) {
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
    <>
      <aside className={styles.deliveryPill} aria-label="Aviso de entrega">
        <span className={styles.pillDot} aria-hidden="true" />
        <span>
          {`Operação exclusiva por delivery • Entrega e instalação em ${deliveryRegion} • Sem retirada`}
        </span>
      </aside>
      <header ref={headerRef} className={styles.header}>
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
              {links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className={styles.link} onClick={() => setMenuOpen(false)}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <StorefrontThemeSwitcher onOpen={() => setMenuOpen(false)} />

          <div className={styles.cta}>
            <WhatsAppButton message="order">Pedir no WhatsApp</WhatsAppButton>
          </div>
        </Container>
      </header>
    </>
  )
}
