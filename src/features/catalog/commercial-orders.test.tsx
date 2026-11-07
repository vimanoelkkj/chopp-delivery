import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { contact } from '@/features/contact/config'
import { buildBarrelOrderMessage, messages } from '@/features/contact/messages'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { WhatsAppNumberContext } from '@/features/contact/WhatsAppNumberContext'
import { buildWhatsAppUrl } from '@/shared/lib/whatsapp'
import { BarrelCarousel3D } from './BarrelCarousel3D'
import { CachacaBanner } from './CachacaBanner'
import { KegCardsGrid } from './KegCardsGrid'
import { PriceComparison } from './PriceComparison'

const number = '5531984400001'
const links = (html: string) =>
  [...html.matchAll(/href="(https:\/\/wa\.me\/[^"\s]+)"/g)].map(
    (match) => new URL(match[1].replaceAll('&amp;', '&')),
  )
const product = {
  id: 'sample',
  name: 'Chopp & Cia',
  description: 'Catálogo sintético',
  visible: true,
  prices: { 30: 510.29, 50: 650.99 },
}

describe('mensagem de uma apresentação de barril', () => {
  it('inclui produto, apresentação, uma unidade e preço unitário sem perder centavos', () => {
    const message = buildBarrelOrderMessage('Chopp & Cia', '30L', 510.29)
    expect(message).toContain('Chopp & Cia (30L)')
    expect(message).toContain('Quantidade: 1 unidade.')
    expect(message.replaceAll('\u00a0', ' ')).toContain('Preço unitário: R$ 510,29.')
    expect(message).not.toContain('total')
    const url = buildWhatsAppUrl(number, message)
    expect(url).toContain(encodeURIComponent(message))
    expect(new URL(url as string).searchParams.get('text')).toBe(message)
  })

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -10, 0, 1.234, 1e20])(
    'preço %s é omitido, sem arredondamento, com pedido de confirmação',
    (price) => {
      const message = buildBarrelOrderMessage('Chopp', '1,5L', price)
      expect(message).toContain('Quantidade: 1 unidade.')
      expect(message).toContain('Preço não informado; favor confirmar.')
      expect(message).not.toMatch(/R\$|NaN|Infinity|undefined|null/)
    },
  )

  it('mantém a formatação exibida para reais inteiros e o menor preço válido', () => {
    expect(buildBarrelOrderMessage('Chopp', '50L', 650).replaceAll('\u00a0', ' ')).toContain(
      'Preço unitário: R$ 650.',
    )
    expect(buildBarrelOrderMessage('Chopp', '750 ml', 0.01)).toContain('0,01')
  })
})

describe('CTAs reais, seleção e precedência comercial', () => {
  const withFallback = (run: () => void) => {
    const previous = contact.whatsappNumber
    try {
      contact.whatsappNumber = number
      run()
    } finally {
      contact.whatsappNumber = previous
    }
  }

  it('tabela usa cada preço/volume e cards usam a seleção de 50 L', () =>
    withFallback(() => {
      const table = links(renderToStaticMarkup(<PriceComparison products={[product]} />))
      expect(table.map((u) => u.searchParams.get('text'))).toEqual([
        buildBarrelOrderMessage(product.name, '30L', 510.29),
        buildBarrelOrderMessage(product.name, '50L', 650.99),
      ])
      const cards = links(
        renderToStaticMarkup(<KegCardsGrid products={[product]} initialVolume={50} />),
      )
      expect(cards[0].searchParams.get('text')).toBe(
        buildBarrelOrderMessage(product.name, '50L', 650.99),
      )
      expect([...table, ...cards].every((u) => u.pathname === `/${number}`)).toBe(true)
    }))

  it.each([1500, 750, 20000])('carrossel preserva %s ml e seu preço efetivo', (volumeMl) =>
    withFallback(() => {
      const html = renderToStaticMarkup(
        <BarrelCarousel3D
          items={[
            {
              ...product,
              variants: [{ code: 'selected', label: 'PET', volumeMl, priceCents: 3590 }],
            },
          ]}
        />,
      )
      const message = links(html)[0].searchParams.get('text') ?? ''
      expect(message).toContain(volumeMl === 1500 ? '1,5L' : volumeMl === 750 ? '750 ml' : '20L')
      expect(message).toContain('Quantidade: 1 unidade.')
      expect(message).toContain('35,90')
      expect(html).toContain('35,90')
      if (volumeMl === 1500) expect(message).not.toContain('2L')
    }),
  )

  it('carrossel sem preço pede confirmação; tabela/cards não oferecem a variante indisponível', () =>
    withFallback(() => {
      const unavailable = { ...product, prices: { 30: null, 50: null } }
      expect(links(renderToStaticMarkup(<PriceComparison products={[unavailable]} />))).toEqual([])
      expect(links(renderToStaticMarkup(<KegCardsGrid products={[unavailable]} />))).toEqual([])
      const html = renderToStaticMarkup(
        <BarrelCarousel3D
          items={[
            {
              ...product,
              variants: [
                { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: null },
              ],
            },
          ]}
        />,
      )
      expect(links(html)[0].searchParams.get('text')).toBe(
        buildBarrelOrderMessage(product.name, '30L', null),
      )
    }))

  it('CMS prevalece sem substituir silenciosamente um número divergente; ausência usa fallback', () =>
    withFallback(() => {
      const message = buildBarrelOrderMessage(product.name, '30L', 510.29)
      for (const cms of [null, number, '5531999999999']) {
        const html = renderToStaticMarkup(
          <WhatsAppNumberContext value={cms}>
            <WhatsAppButton customText={message}>Pedir</WhatsAppButton>
          </WhatsAppNumberContext>,
        )
        expect(links(html)[0].pathname).toBe(`/${cms ?? number}`)
        expect(links(html)[0].searchParams.get('text')).toBe(message)
      }
    }))

  it('preserva mensagens genéricas e pedido de cachaça com variante e preço', () =>
    withFallback(() => {
      const generic = renderToStaticMarkup(<WhatsAppButton>Pedir</WhatsAppButton>)
      expect(links(generic)[0].searchParams.get('text')).toBe(messages.order)
      const bottle = renderToStaticMarkup(
        <CachacaBanner
          item={{
            title: 'Temos cachaça',
            description: 'Fixture',
            variants: [{ code: '700', label: 'Garrafa', volumeMl: 700, priceCents: 3590 }],
          }}
        />,
      )
      const message = links(bottle)[0].searchParams.get('text') ?? ''
      expect(message).toContain('cachaça (Garrafa - 700ml por R$')
      expect(message).toContain('35,90')
      expect(links(bottle)[0].pathname).toBe(`/${number}`)
    }))
})
