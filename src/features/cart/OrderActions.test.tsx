import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WhatsAppNumberContext } from '@/features/contact/WhatsAppNumberContext'
import { type CartApi, CartContext } from './CartContext'
import { OrderActions } from './OrderActions'

const line = {
  itemId: 'brahma',
  variantCode: '30',
  name: 'Brahma',
  label: 'Barril de 30 L',
  unitPriceCents: 45000,
}
const props = {
  line,
  quantity: 1,
  directMessage: 'Olá Brahma',
  subject: 'Brahma, Barril de 30 L',
  legacyLabel: 'Pedir',
}
const api = { lines: [], add() {} } as unknown as CartApi
const render = (withCart: boolean) =>
  renderToStaticMarkup(
    <WhatsAppNumberContext value="5531900000000">
      {withCart ? (
        <CartContext value={api}>
          <OrderActions {...props} />
        </CartContext>
      ) : (
        <OrderActions {...props} />
      )}
    </WhatsAppNumberContext>,
  )

describe('OrderActions', () => {
  it('com carrinho: botão principal e link secundário de pedido direto', () => {
    const html = render(true)
    expect(html).toContain('Adicionar ao pedido')
    expect(html).toContain('Pedir somente este produto')
    expect(html).toContain('https://wa.me/5531900000000?text=')
  })
  it('sem carrinho: mantém só o pedido direto anterior', () => {
    const html = render(false)
    expect(html).not.toContain('Adicionar ao pedido')
    expect(html).toContain('>Pedir<')
  })
})
