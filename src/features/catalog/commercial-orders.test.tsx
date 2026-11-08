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
    expect(message.replaceAll(' ', ' ')).toContain('Total: R$ 510,29.')
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

describe('quantidade e total no pedido', () => {
  const plain = (text: string) => text.replaceAll(' ', ' ')

  it.each([
    [1, 'Quantidade: 1 unidade.', 'Total: R$ 510,29.'],
    [2, 'Quantidade: 2 unidades.', 'Total: R$ 1.020,58.'],
    [3, 'Quantidade: 3 unidades.', 'Total: R$ 1.530,87.'],
  ])('quantidade %s identifica produto, volume, unitário e total exato', (qty, q, total) => {
    const message = plain(buildBarrelOrderMessage('Chopp', '1,5L', 510.29, qty))
    expect(message).toContain('Chopp (1,5L)')
    expect(message).toContain(q)
    expect(message).toContain('Preço unitário: R$ 510,29.')
    expect(message).toContain(total)
  })

  it('total é calculado em centavos, sem erro de ponto flutuante', () => {
    expect(plain(buildBarrelOrderMessage('X', '30L', 19.99, 3))).toContain('Total: R$ 59,97.')
    expect(plain(buildBarrelOrderMessage('X', '30L', 0.1, 3))).toContain('Total: R$ 0,30.')
  })

  it.each([0, -1, 1.5, Number.NaN])('quantidade inválida %s vira 1', (qty) => {
    expect(buildBarrelOrderMessage('X', '30L', 10, qty)).toContain('Quantidade: 1 unidade.')
  })

  it('quantidade acima do limite é limitada a 99', () => {
    expect(buildBarrelOrderMessage('X', '30L', 10, 1e12)).toContain('Quantidade: 99 unidades.')
  })

  it('sem preço válido não calcula total, mesmo com quantidade maior que 1', () => {
    const message = buildBarrelOrderMessage('X', '30L', null, 3)
    expect(message).toContain('Quantidade: 3 unidades.')
    expect(message).toContain('Preço não informado; favor confirmar.')
    expect(message).not.toMatch(/Total|R\$/)
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
      expect(message).toContain('cachaça (Garrafa - 700ml)')
      expect(message).toContain('Quantidade: 1 unidade.')
      expect(message).toContain('35,90')
      expect(links(bottle)[0].pathname).toBe(`/${number}`)
    }))
})

describe('seletor de quantidade (markup acessível)', () => {
  const plain = (text: string) => text.replaceAll(' ', ' ')
  const prev = contact.whatsappNumber

  it('começa em 1, bloqueia "−" e nomeia grupo e botões pelo produto e volume', () => {
    contact.whatsappNumber = number
    try {
      const html = plain(renderToStaticMarkup(<KegCardsGrid products={[product]} />))
      expect(html).toContain('aria-label="Quantidade de Chopp &amp; Cia, barril de 30 litros"')
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Diminuir quantidade de Chopp/)
      expect(html).toContain('aria-label="Aumentar quantidade de Chopp &amp; Cia, barril de 30')
      expect(html).toMatch(/<output[^>]*>.*?1<\/output>/)
      expect(html).toContain('Total</span><strong>R$ 510,29</strong>')
    } finally {
      contact.whatsappNumber = prev
    }
  })

  it('produto indisponível não oferece seletor nem pedido', () => {
    const unavailable = { ...product, prices: { 30: null, 50: 650.99 } }
    const html = renderToStaticMarkup(<KegCardsGrid products={[unavailable]} initialVolume={30} />)
    expect(html).not.toContain('Aumentar quantidade')
    expect(html).toContain('disabled')
  })

  it('tabela: cada volume tem seu seletor; volume indisponível não tem', () => {
    const html = renderToStaticMarkup(
      <PriceComparison products={[{ ...product, prices: { 30: 510.29, 50: null } }]} />,
    )
    expect(html.match(/Aumentar quantidade/g)).toHaveLength(1)
    expect(html).toContain('barril de 30 litros')
    expect(html).not.toContain('barril de 50 litros"')
  })

  it('carrossel e cachaça (garrafa 1,5 L) exibem seletor com total inicial igual ao unitário', () => {
    contact.whatsappNumber = number
    try {
      const carousel = plain(
        renderToStaticMarkup(
          <BarrelCarousel3D
            items={[
              {
                ...product,
                variants: [{ code: 'x', label: 'PET', volumeMl: 1500, priceCents: 3590 }],
              },
            ]}
          />,
        ),
      )
      expect(carousel).toContain('Aumentar quantidade de Chopp &amp; Cia')
      expect(carousel).toContain('Total</span><strong>R$ 35,90</strong>')
    } finally {
      contact.whatsappNumber = prev
    }
  })
})
