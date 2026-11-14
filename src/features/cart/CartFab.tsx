import { useCart } from './CartContext'
import styles from './CartFab.module.css'

/** Botão flutuante de 56 x 56 px com o total de unidades; substitui o WhatsApp flutuante. */
export function CartFab() {
  const cart = useCart()
  if (!cart) return null
  const label = `Abrir meu pedido, ${cart.unitCount} ${cart.unitCount === 1 ? 'unidade' : 'unidades'}`
  return (
    <button
      type="button"
      id="pedido-flutuante"
      className={styles.fab}
      aria-label={label}
      aria-haspopup="dialog"
      data-testid="cart-fab"
      onClick={cart.openPanel}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <path
          d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2M9 20.5h.01M17 20.5h.01"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.count} aria-hidden="true">
        {cart.unitCount > 99 ? '99+' : cart.unitCount}
      </span>
    </button>
  )
}
