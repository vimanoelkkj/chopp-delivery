import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { CartContext } from './CartContext'
import { CartFab } from './CartFab'
import { CartPanel } from './CartPanel'
import {
  addToCart,
  CART_STORAGE_KEY,
  type CartLine,
  cartTotalCents,
  cartUnitCount,
  parseStoredCart,
  removeLine,
  serializeCart,
  setLineQuantity,
} from './cart'

function readStorage(): CartLine[] {
  try {
    return parseStoredCart(window.localStorage.getItem(CART_STORAGE_KEY))
  } catch {
    return []
  }
}

/** Pedido local: vive só no navegador (localStorage). Nada é criado no servidor. */
export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(readStorage)
  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => {
    try {
      if (lines.length) window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(lines))
      else window.localStorage.removeItem(CART_STORAGE_KEY)
    } catch {
      /* armazenamento indisponível: o pedido segue só em memória */
    }
  }, [lines])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) setLines(readStorage())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const add = useCallback((line: CartLine) => setLines((l) => addToCart(l, line)), [])
  const setQuantity = useCallback(
    (key: string, q: number) => setLines((l) => setLineQuantity(l, key, q)),
    [],
  )
  const remove = useCallback((key: string) => setLines((l) => removeLine(l, key)), [])
  const replace = useCallback((next: CartLine[]) => setLines(next), [])
  const clear = useCallback(() => setLines([]), [])
  const openPanel = useCallback(() => setPanelOpen(true), [])
  const closePanel = useCallback(() => setPanelOpen(false), [])

  const api = useMemo(
    () => ({
      lines,
      unitCount: cartUnitCount(lines),
      totalCents: cartTotalCents(lines),
      panelOpen,
      add,
      setQuantity,
      remove,
      replace,
      clear,
      openPanel,
      closePanel,
    }),
    [lines, panelOpen, add, setQuantity, remove, replace, clear, openPanel, closePanel],
  )

  return (
    <CartContext value={api}>
      {children}
      {lines.length > 0 ? <CartFab /> : null}
      {panelOpen ? <CartPanel /> : null}
    </CartContext>
  )
}
