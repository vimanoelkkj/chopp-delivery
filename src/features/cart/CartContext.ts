import { createContext, useContext } from 'react'
import type { CartLine } from './cart'

export type CartApi = {
  lines: CartLine[]
  unitCount: number
  totalCents: number
  panelOpen: boolean
  add: (line: CartLine) => void
  setQuantity: (key: string, quantity: number) => void
  remove: (key: string) => void
  replace: (lines: CartLine[]) => void
  clear: () => void
  openPanel: () => void
  closePanel: () => void
}

/** `null` fora do provider: os botões voltam a oferecer só o pedido direto pelo WhatsApp. */
export const CartContext = createContext<CartApi | null>(null)

export const useCart = () => useContext(CartContext)
