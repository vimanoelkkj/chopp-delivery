import { describe, expect, it } from 'vitest'
import type { PublicCatalog } from '../../../shared/catalog'
import {
  addToCart,
  type CartLine,
  cartSignature,
  cartTotalCents,
  cartUnitCount,
  lineKey,
  parseStoredCart,
  removeLine,
  serializeCart,
  setLineQuantity,
} from './cart'
import { buildCartMessage } from './message'
import { reconcileCart } from './reconcile'

const brahma30: CartLine = {
  itemId: 'brahma',
  variantCode: '30',
  name: 'Brahma',
  label: 'Barril de 30 L',
  unitPriceCents: 45000,
  quantity: 1,
}
const brahma50 = { ...brahma30, variantCode: '50', label: 'Barril de 50 L', unitPriceCents: 70010 }

describe('carrinho', () => {
  it('agrupa item e variante iguais e separa variantes diferentes', () => {
    let lines = addToCart([], brahma30)
    lines = addToCart(lines, { ...brahma30, quantity: 2 })
    lines = addToCart(lines, brahma50)
    expect(lines).toHaveLength(2)
    expect(lines[0].quantity).toBe(3)
  })

  it('limita a 99 unidades por linha', () => {
    const lines = addToCart(addToCart([], { ...brahma30, quantity: 98 }), {
      ...brahma30,
      quantity: 5,
    })
    expect(lines[0].quantity).toBe(99)
  })

  it('calcula subtotais e total em centavos inteiros', () => {
    const lines = addToCart(addToCart([], { ...brahma30, quantity: 3 }), brahma50)
    expect(cartTotalCents(lines)).toBe(3 * 45000 + 70010)
    expect(cartUnitCount(lines)).toBe(4)
  })

  it('edita quantidade e remove', () => {
    const lines = addToCart([], brahma30)
    expect(setLineQuantity(lines, lineKey(brahma30), 7)[0].quantity).toBe(7)
    expect(setLineQuantity(lines, lineKey(brahma30), 0)[0].quantity).toBe(1)
    expect(removeLine(lines, lineKey(brahma30))).toEqual([])
  })

  it('persiste e descarta dados corrompidos do localStorage', () => {
    const lines = addToCart([], brahma30)
    expect(parseStoredCart(serializeCart(lines))).toEqual(lines)
    expect(parseStoredCart('{nope')).toEqual([])
    expect(parseStoredCart(null)).toEqual([])
    const bad = JSON.stringify({ v: 1, lines: [{ ...brahma30, unitPriceCents: 1.5 }, brahma50] })
    expect(parseStoredCart(bad)).toEqual([brahma50])
  })
})

const catalog = (items: PublicCatalog['categories'][number]['items']): PublicCatalog => ({
  revision: 'r',
  categories: [{ id: 'chopes', name: 'Chopes', items }],
})
const item = (visible: boolean, priceCents: number | null) => ({
  id: 'brahma',
  name: 'Brahma Nova',
  description: '',
  visible,
  variants: [{ code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents }],
})

describe('reconcileCart', () => {
  const lines = [brahma30, brahma50]
  it('mantém limpo quando nada mudou', () => {
    const r = reconcileCart([brahma30], catalog([item(true, 45000)]))
    expect(r.clean).toBe(true)
  })
  it('detecta mudança de preço e aplica o novo', () => {
    const r = reconcileCart([brahma30], catalog([item(true, 48000)]))
    expect(r.clean).toBe(false)
    expect(r.issues.changed[0]).toMatchObject({ fromCents: 45000, toCents: 48000 })
    expect(r.lines[0]).toMatchObject({ unitPriceCents: 48000, name: 'Brahma Nova' })
  })
  it('preserva a quantidade atual ao aplicar o catálogo (não restaura snapshot)', () => {
    const edited = { ...brahma30, quantity: 5 }
    const r = reconcileCart([edited], catalog([item(true, 48000)]))
    expect(r.lines[0]).toMatchObject({ quantity: 5, unitPriceCents: 48000 })
  })
  it('assinatura do pedido muda com quantidade, preço ou remoção', () => {
    const base = cartSignature([brahma30])
    expect(cartSignature([{ ...brahma30, quantity: 2 }])).not.toBe(base)
    expect(cartSignature([{ ...brahma30, unitPriceCents: 1 }])).not.toBe(base)
    expect(cartSignature([])).not.toBe(base)
  })
  it('remove variante inexistente, item oculto e variante sem preço', () => {
    expect(reconcileCart(lines, catalog([item(true, 45000)])).issues.removed).toEqual([brahma50])
    expect(reconcileCart([brahma30], catalog([item(false, 45000)])).lines).toEqual([])
    expect(reconcileCart([brahma30], catalog([item(true, null)])).issues.removed).toHaveLength(1)
    expect(reconcileCart([brahma30], catalog([])).issues.removed).toHaveLength(1)
  })
})

describe('buildCartMessage', () => {
  it('estrutura itens, total estimado e frete a confirmar', () => {
    const msg = buildCartMessage([{ ...brahma30, quantity: 2 }, brahma50]).replace(/ /g, ' ')
    expect(msg).toContain('1. Brahma (Barril de 30 L)\n   2 x R$ 450,00 = R$ 900,00')
    expect(msg).toContain('2. Brahma (Barril de 50 L)\n   1 x R$ 700,10 = R$ 700,10')
    expect(msg).toContain('Total estimado: R$ 1.600,10')
    expect(msg).toContain('Frete: a confirmar.')
  })
})
