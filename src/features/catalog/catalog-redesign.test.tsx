import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  BarrelCarousel3D,
  createKeyboardNavHandler,
  isHorizontalSwipeIntent,
} from '@/features/catalog/BarrelCarousel3D'
import { CachacaBanner, cachacaProductName } from '@/features/catalog/CachacaBanner'
import { KegCardsGrid } from '@/features/catalog/KegCardsGrid'
import type { Product } from '@/features/catalog/types'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { contact } from '@/features/contact/config'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { faqItems } from '@/features/faq/faq-items'
import { BarrelsSection } from '@/pages/landing/sections/BarrelsSection'
import { ContactSection } from '@/pages/landing/sections/ContactSection'
import { Hero } from '@/pages/landing/sections/Hero'
import { Ticker } from '@/pages/landing/sections/Ticker'

const mockChopeItems = [
  {
    id: 'dronken',
    name: 'Dronken',
    description: 'Double Double Artesanal',
    visible: true,
    variants: [
      { code: 'dronken-30', label: '30L', volumeMl: 30000, priceCents: 51000 },
      { code: 'dronken-50', label: '50L', volumeMl: 50000, priceCents: 65000 },
    ],
  },
  {
    id: 'palato-beber',
    name: 'Palato Beber',
    description: 'Pilsen Artesanal',
    visible: true,
    variants: [
      { code: 'palato-30', label: '30L', volumeMl: 30000, priceCents: 49000 },
      { code: 'palato-50', label: '50L', volumeMl: 50000, priceCents: 64000 },
    ],
  },
]

const mockProducts: Product[] = [
  {
    id: 'dronken',
    name: 'Dronken',
    description: 'Double Double Artesanal',
    prices: { 30: 510, 50: 650 },
    visible: true,
  },
  {
    id: 'heineken',
    name: 'Heineken',
    description: 'Puro Malte (somente 50L)',
    prices: { 30: null, 50: 990 },
    visible: true,
  },
  {
    id: 'kaiser',
    name: 'Kaiser',
    description: 'Pilsen leve (somente 30L)',
    prices: { 30: 450, 50: null },
    visible: true,
  },
]

describe('Fase 6.2: Validação Estrutural e Regressões do Redesign Chopp Delivery', () => {
  describe('P1-A / A01: BarrelsSection - Eliminação de dados comerciais fictícios', () => {
    it('estado loading não exibe R$ nem produtos fictícios (M01)', () => {
      const html = renderToString(<BarrelsSection state={{ status: 'loading' }} />)
      expect(html).toContain('role="status"')
      expect(html).toContain('Carregando vitrine de barris')
      expect(html).not.toContain('R$')
      expect(html).not.toContain('Palato Beber')
      expect(html).not.toContain('490')
    })

    it('estado error não exibe R$ nem produtos fictícios', () => {
      const html = renderToString(<BarrelsSection state={{ status: 'error' }} />)
      expect(html).toContain('Vitrine de barris indisponível')
      expect(html).not.toContain('R$')
      expect(html).not.toContain('Palato Beber')
    })

    it('estado ready com catálogo vazio não exibe R$ nem produtos fictícios', () => {
      const emptyState: CatalogState = {
        status: 'ready',
        catalog: {
          products: [],
          expanded: { revision: 'r1', categories: [{ id: 'chopes', name: 'Chopes', items: [] }] },
        },
      }
      const html = renderToString(<BarrelsSection state={emptyState} />)
      expect(html).toContain('role="status"')
      expect(html).toContain('Nenhum barril disponível')
      expect(html).not.toContain('R$')
    })

    it('estado ready com itens reais renderiza o carrossel dinâmico', () => {
      const readyState: CatalogState = {
        status: 'ready',
        catalog: {
          products: mockProducts,
          expanded: {
            revision: 'r1',
            categories: [{ id: 'chopes', name: 'Chopes', items: mockChopeItems }],
          },
        },
      }
      const html = renderToString(<BarrelsSection state={readyState} />)
      expect(html).toContain('Dronken')
      expect(html).toContain('Palato Beber')
      expect(html).toContain('R$')
    })
  })

  describe('P1-B / A02 & M02: WhatsAppButton e Fallback de Telefone', () => {
    it('quando whatsappNumber está nulo, exibe fallback honesto e não gera wa.me sem telefone', () => {
      const prev = contact.whatsappNumber
      try {
        contact.whatsappNumber = null
        const html = renderToString(
          <WhatsAppButton customText="Olá! Quero pedir Chopp">Pedir Agora</WhatsAppButton>,
        )
        expect(html).not.toContain('https://wa.me/?text=')
        expect(html).not.toContain('https://wa.me/?')
        expect(html).toContain('Pedir Agora')
      } finally {
        contact.whatsappNumber = prev
      }
    })

    it('KegCardsGrid não gera links mortos wa.me/?text= quando telefone não configurado (M02)', () => {
      const prev = contact.whatsappNumber
      try {
        contact.whatsappNumber = null
        const html = renderToString(<KegCardsGrid products={mockProducts} />)
        expect(html).not.toContain('href="https://wa.me/?text=')
        expect(html).not.toContain('https://wa.me/?text=pedido')
      } finally {
        contact.whatsappNumber = prev
      }
    })

    it('quando whatsappNumber está configurado, gera link válido com texto contextual preservado', () => {
      const prev = contact.whatsappNumber
      try {
        contact.whatsappNumber = '5532999999999'
        const customMessage = 'Olá! Gostaria de pedir o barril Dronken (50L).'
        const html = renderToString(
          <WhatsAppButton customText={customMessage}>Pedir Agora</WhatsAppButton>,
        )
        expect(html).toContain('href="https://wa.me/5532999999999?text=')
        expect(html).toContain(encodeURIComponent(customMessage))
      } finally {
        contact.whatsappNumber = prev
      }
    })
  })

  describe('P1-C / A03, M03 & M09: Mensagens Contextuais de Pedido', () => {
    it('BarrelCarousel3D utiliza orderMessage contextual e não mensagem genérica (M03)', () => {
      const prev = contact.whatsappNumber
      try {
        contact.whatsappNumber = '5532999999999'
        const html = renderToString(<BarrelCarousel3D items={mockChopeItems} />)
        const decoded = decodeURIComponent(html)
        expect(decoded).toContain('pedir o barril de Dronken (30L)')
      } finally {
        contact.whatsappNumber = prev
      }
    })

    it('CachacaBanner utiliza WhatsAppButton contextual e não gera link morto', () => {
      const prev = contact.whatsappNumber
      try {
        contact.whatsappNumber = null
        const html = renderToString(
          <CachacaBanner
            item={{
              title: 'Cachaça Século XVIII',
              description: 'Alambique tradicional de Minas Gerais',
              variants: [
                { code: 'tradicional', label: 'Tradicional', volumeMl: 700, priceCents: 8500 },
                { code: 'reserva', label: 'Reserva Especial', volumeMl: 700, priceCents: 14000 },
              ],
            }}
          />,
        )
        expect(html).not.toContain('href="https://wa.me/?text=')
        expect(html).toContain('Tradicional')
        expect(html).toContain('Reserva Especial')
        expect(html).toContain('85,00')
        expect(html).toContain('140,00')
      } finally {
        contact.whatsappNumber = prev
      }
    })

    it('CachacaBanner inclui mensagem com variante, volume e preço por garrafa (M09)', () => {
      const prev = contact.whatsappNumber
      try {
        contact.whatsappNumber = '5532999999999'
        const html = renderToString(
          <CachacaBanner
            item={{
              title: 'Cachaça Século XVIII',
              description: 'Alambique tradicional',
              variants: [
                { code: '700', label: 'Tradicional', volumeMl: 700, priceCents: 3000 },
                { code: '1000', label: 'Reserva', volumeMl: 1000, priceCents: 4500 },
              ],
            }}
          />,
        )
        const decoded = decodeURIComponent(html).replace(/\u00A0/g, ' ')
        expect(decoded).toContain('Tradicional - 700ml por R$ 30,00')
        expect(decoded).toContain('Reserva - 1000ml por R$ 45,00')
      } finally {
        contact.whatsappNumber = prev
      }
    })
  })

  describe('Carrossel refinado: controles acessíveis e geometria por variáveis', () => {
    it('expõe o volume ativo com aria-pressed e mantém rótulo e preço reais', () => {
      const html = renderToString(<BarrelCarousel3D items={mockChopeItems} />)
      expect(html).toContain('aria-pressed="true"')
      expect(html).toMatch(
        /<span class="[^"]*">30L<\/span><span class="[^"]*">R\$\s*510,00<\/span>/,
      )
      expect(html).toMatch(
        /<span class="[^"]*">50L<\/span><span class="[^"]*">R\$\s*650,00<\/span>/,
      )
    })

    it('mantém os nomes acessíveis dos botões de navegação mesmo sem o texto visível', () => {
      const html = renderToString(<BarrelCarousel3D items={mockChopeItems} />)
      expect(html).toContain('aria-label="Barril Anterior"')
      expect(html).toContain('aria-label="Próximo Barril"')
    })

    it('aceita className para ajustar a geometria sem depender de nomes gerados do CSS Module', () => {
      const html = renderToString(<BarrelCarousel3D items={mockChopeItems} className="demo-geo" />)
      expect(html).toMatch(/<div class="[^"]*[ "]demo-geo[ "]/)
    })
  })

  describe('Texto da cachaça na mensagem de WhatsApp', () => {
    it('não repete a chamada "Temos" do catálogo como se fosse o nome do produto', () => {
      const prev = contact.whatsappNumber
      try {
        contact.whatsappNumber = '5532999999999'
        const html = renderToString(
          <CachacaBanner
            item={{
              title: 'Temos cachaça',
              description: 'Conservada em barril de umburana com jequitibá rosa',
              variants: [{ code: 'bottle', label: 'Garrafa', volumeMl: 700, priceCents: 3000 }],
            }}
          />,
        )
        const decoded = decodeURIComponent(html).replace(/ /g, ' ')
        expect(decoded).not.toContain('adicionar a Temos cachaça')
        expect(decoded).toContain('adicionar a cachaça (Garrafa - 700ml por R$ 30,00)')
      } finally {
        contact.whatsappNumber = prev
      }
    })

    it('mantém o nome de cachaças que não usam a chamada "Temos"', () => {
      expect(cachacaProductName('Cachaça Ouro')).toBe('Cachaça Ouro')
      expect(cachacaProductName('Temos cachaça')).toBe('cachaça')
      expect(cachacaProductName('  temos Cachaça Prata ')).toBe('Cachaça Prata')
    })
  })

  describe('P1-D / A04 e A11: Hero Dinâmico e Alinhamento Visual', () => {
    it('não exibe preço fixo de R$ 640 quando catálogo está loading, error ou vazio (M04)', () => {
      const htmlLoading = renderToString(<Hero state={{ status: 'loading' }} />)
      expect(htmlLoading).not.toContain('A partir de R$ 640')
      expect(htmlLoading).not.toContain('pillPrice')

      const htmlError = renderToString(<Hero state={{ status: 'error' }} />)
      expect(htmlError).not.toContain('A partir de R$ 640')
      expect(htmlError).not.toContain('pillPrice')
    })

    it('deriva o menor preço real quando catálogo está pronto (M04)', () => {
      const readyState: CatalogState = {
        status: 'ready',
        catalog: {
          products: mockProducts, // min 50L is 650, min overall is 450 (Kaiser 30L)
          expanded: {
            revision: 'r1',
            categories: [{ id: 'chopes', name: 'Chopes', items: mockChopeItems }],
          },
        },
      }
      const html = renderToString(<Hero state={readyState} />)
      expect(html).toContain('A partir de')
      expect(html).toContain('650,00')
    })
  })

  describe('P1-E / A05, M05 & M10: BarrelCarousel3D - Sincronização e Variantes', () => {
    it('com 1 produto exibe status 1 de 1 sem duplicar ou exibir índice 2 (M10)', () => {
      const html = renderToString(<BarrelCarousel3D items={[mockChopeItems[0]]} />)
      expect(html).toContain('Barril <span class="')
      expect(html).toContain('>1</span> de 1')
      expect(html).not.toContain('>2</span> de 1')
      expect(html).not.toContain('Anterior')
      expect(html).not.toContain('Próximo')
    })

    it('com múltiplos produtos exibe status 1 de N e controles de navegação', () => {
      const html = renderToString(<BarrelCarousel3D items={mockChopeItems} />)
      const clean = html.replace(/<!--.*?-->/g, '')
      expect(clean).toContain('de 2')
      expect(clean).toContain('Anterior')
      expect(clean).toContain('Próximo')
    })

    it('BarrelCarousel3D sincroniza pelo initialSelectedId (M05)', () => {
      // Index 1 is Palato Beber
      const html = renderToString(
        <BarrelCarousel3D items={mockChopeItems} initialSelectedId="palato-beber" />,
      )
      const clean = html.replace(/<!--.*?-->/g, '')
      expect(clean).toContain('Barril <span class="')
      expect(clean).toContain('>2</span> de 2')
      expect(clean).toContain('Palato Beber')
      expect(clean).toContain('Pedir Barril Palato Beber no WhatsApp')
    })

    it('exibe variantes não convencionais quando produto não usa 30L/50L padrão (A06)', () => {
      const customItem = {
        id: 'growler-chopp',
        name: 'Growler Especial',
        description: 'Chopp em Growler Pet',
        visible: true,
        variants: [
          { code: 'g1', label: '1L', volumeMl: 1000, priceCents: 2500 },
          { code: 'g2', label: '2L', volumeMl: 2000, priceCents: 4500 },
        ],
      }
      const html = renderToString(<BarrelCarousel3D items={[customItem]} />)
      expect(html).toContain('1L')
      expect(html).toContain('2L')
      expect(html).toContain('25,00')
    })
  })

  describe('A07 & M06: KegCardsGrid - Mensagens de Tamanho e Litragem Selecionada', () => {
    it('indica corretamente a litragem disponível quando o volume selecionado não existe', () => {
      const html = renderToString(<KegCardsGrid products={mockProducts} />)
      expect(html).toContain('Somente 50 Litros')
      expect(html).toContain('Apenas 50L')
      expect(html).toContain('Apenas 30L')
    })

    it('KegCardsGrid exibe "Somente 30 Litros" quando volume 50L selecionado em produto exclusivo 30L (M06)', () => {
      // Kaiser only has 30L
      const html = renderToString(<KegCardsGrid products={mockProducts} initialVolume={50} />)
      expect(html).toContain('Somente 30 Litros')
      expect(html).not.toContain('Somente 50 Litros')
    })

    it('não exibe a tag não autorizada "Em estoque" (A12)', () => {
      const html = renderToString(<KegCardsGrid products={mockProducts} />)
      expect(html).not.toContain('Em estoque')
    })
  })

  describe('A08, M07 & M11: Comportamento de Foco de Teclado no BarrelCarousel3D', () => {
    it('ignora setas de teclado quando o carrossel não possui o foco (M07 & M11)', () => {
      let navigated = false
      const wrapperRef = { current: null as HTMLElement | null }
      const prevDoc = globalThis.document
      try {
        globalThis.document = { activeElement: {} } as unknown as Document
        const onKeyDown = createKeyboardNavHandler(
          2,
          wrapperRef,
          () => {
            navigated = true
          },
          () => {
            navigated = true
          },
        )

        // Quando o carrossel não contém o activeElement, não deve navegar
        onKeyDown({ key: 'ArrowRight' })
        expect(navigated).toBe(false)
        onKeyDown({ key: 'ArrowLeft' })
        expect(navigated).toBe(false)
      } finally {
        globalThis.document = prevDoc
      }
    })

    it('permite navegação por setas quando o carrossel detém o foco', () => {
      let direction = ''
      const fakeElement = {} as Element
      const wrapperRef = {
        current: {
          contains: (el: Element | null) => el === fakeElement,
        } as unknown as HTMLElement,
      }
      const prevDoc = globalThis.document
      try {
        globalThis.document = { activeElement: fakeElement } as unknown as Document
        const onKeyDown = createKeyboardNavHandler(
          2,
          wrapperRef,
          () => {
            direction = 'next'
          },
          () => {
            direction = 'prev'
          },
        )

        onKeyDown({ key: 'ArrowRight' })
        expect(direction).toBe('next')
        onKeyDown({ key: 'ArrowLeft' })
        expect(direction).toBe('prev')
      } finally {
        globalThis.document = prevDoc
      }
    })
  })

  describe('A09, M08 & M12: Validação Comportamental de Gestos Touch no BarrelCarousel3D', () => {
    it('rejeita gestos predominantemente verticais ou com diffY significativo (M08 & M12)', () => {
      // Movimento vertical dominante: diffX não supera diffY * 1.5
      expect(isHorizontalSwipeIntent(-50, -100)).toBe(false)
      expect(isHorizontalSwipeIntent(50, 100)).toBe(false)
      expect(isHorizontalSwipeIntent(-50, 50)).toBe(false)
      // Abaixo do threshold de 40px
      expect(isHorizontalSwipeIntent(30, 0)).toBe(false)
      expect(isHorizontalSwipeIntent(-35, 5)).toBe(false)
    })

    it('aceita swipe horizontal com intenção clara', () => {
      // Movimento horizontal nítido
      expect(isHorizontalSwipeIntent(-80, 5)).toBe(true)
      expect(isHorizontalSwipeIntent(60, 10)).toBe(true)
      expect(isHorizontalSwipeIntent(-50, 0)).toBe(true)
    })
  })

  describe('A16: Ticker - Regra de Negócio 100% Delivery e Sem Retirada', () => {
    it('não contém a palavra "Retirada" no letreiro', () => {
      const html = renderToString(<Ticker />)
      expect(html.toLowerCase()).not.toContain('retirada')
      expect(html).toContain('100% Delivery')
      expect(html).toContain('Instalação inclusa')
    })
  })

  describe('Fase 6.2 - Cenários Obrigatórios de Validação Comercial', () => {
    it('Cenário A: volumes livres (20L e 40L) são individualmente exibidos e identificados no CTA', () => {
      const customItem = {
        id: 'custom-keg',
        name: 'Artesanal Custom',
        description: 'Barril sob medida',
        visible: true,
        variants: [
          { code: 'v20', label: 'Especial', volumeMl: 20000, priceCents: 22000 },
          { code: 'v40', label: 'Festa', volumeMl: 40000, priceCents: 39000 },
        ],
      }
      const prev = contact.whatsappNumber
      try {
        contact.whatsappNumber = '5532999999999'
        const html = renderToString(<BarrelCarousel3D items={[customItem]} />)
        expect(html).toContain('Especial (20L)')
        expect(html).toContain('Festa (40L)')
        expect(html).toContain('220,00')
        expect(html).toContain('390,00')

        const decoded = decodeURIComponent(html)
        expect(decoded).toContain('Artesanal Custom (Especial - 20L)')
      } finally {
        contact.whatsappNumber = prev
      }
    })

    it('Cenário B: mesmo volume com preços diferentes (duas variantes 50L) são ambas acessíveis', () => {
      const dualItem = {
        id: 'dual-50',
        name: 'Duas50',
        description: 'Duas opções de 50L',
        visible: true,
        variants: [
          { code: 'v1', label: 'Premium', volumeMl: 50000, priceCents: 99999 },
          { code: 'v2', label: 'Clássico', volumeMl: 50000, priceCents: 55555 },
        ],
      }
      const html = renderToString(<BarrelCarousel3D items={[dualItem]} />)
      expect(html).toContain('Premium 50L')
      expect(html).toContain('Clássico 50L')
      expect(html).toContain('999,99')
      expect(html).toContain('555,55')
    })

    it('Cenário C: item misto (30L, 50L e 20L) exibe a variante 20L na vitrine', () => {
      const mixedItem = {
        id: 'mixed-keg',
        name: 'Misto',
        description: 'Linha completa',
        visible: true,
        variants: [
          { code: '30', label: '30L', volumeMl: 30000, priceCents: 45000 },
          { code: '50', label: '50L', volumeMl: 50000, priceCents: 60000 },
          { code: 'special20', label: 'Especial20', volumeMl: 20000, priceCents: 32000 },
        ],
      }
      const html = renderToString(<BarrelCarousel3D items={[mixedItem]} />)
      expect(html).toContain('30L')
      expect(html).toContain('50L')
      expect(html).toContain('Especial20 (20L)')
      expect(html).toContain('320,00')
    })

    it('Cenário D: preserva produto ativo por ID ao sincronizar ou reordenar', () => {
      const itemsReversed = [mockChopeItems[1], mockChopeItems[0]]
      const html = renderToString(
        <BarrelCarousel3D items={itemsReversed} initialSelectedId="palato-beber" />,
      )
      const clean = html.replace(/<!--.*?-->/g, '')
      expect(clean).toContain('Palato Beber')
      expect(clean).toContain('Pedir Barril Palato Beber no WhatsApp')
    })

    it('V3-N01: volumes fracionários (1500ml e 750ml) são preservados de forma exata sem arredondamento comercial', () => {
      const fractionalItem = {
        id: 'growler-fractional',
        name: 'Growler Artesanal',
        description: 'Growler PET',
        visible: true,
        variants: [
          { code: 'g75', label: 'Garrafa 750ml', volumeMl: 750, priceCents: 2000 },
          { code: 'g15', label: 'Growler PET', volumeMl: 1500, priceCents: 3590 },
          { code: 'g20', label: 'Growler 2L', volumeMl: 2000, priceCents: 4500 },
        ],
      }
      const prev = contact.whatsappNumber
      try {
        contact.whatsappNumber = '5532999999999'
        const html = renderToString(
          <BarrelCarousel3D items={[fractionalItem]} initialSelectedId="growler-fractional" />,
        )
        // Deve exibir 1,5L de forma exata, nunca arredondado para 2L
        expect(html).toContain('1,5L')
        expect(html).toContain('750 ml')
        expect(html).toContain('35,90')
        expect(html).not.toContain('Growler PET (2L)')

        const decoded = decodeURIComponent(html)
        expect(decoded).toMatch(/1,5\s*L|1500\s*ml/i)
      } finally {
        contact.whatsappNumber = prev
      }
    })

    it('V3-N03: KegCardsGrid utiliza tag neutra "Barril Inox" e não inventa estilos comerciais', () => {
      const productsWithCustomDesc: Product[] = [
        {
          id: 'heineken',
          name: 'Produto editado pelo CMS',
          description: 'Chopp de vinho artesanal produzido sem malte de cevada',
          prices: { 30: 300, 50: 500 },
          visible: true,
        },
        {
          id: 'novo-item',
          name: 'Produto novo',
          description: '',
          prices: { 30: 300, 50: 500 },
          visible: true,
        },
      ]
      const html = renderToString(<KegCardsGrid products={productsWithCustomDesc} />)
      expect(html).toContain('Barril Inox')
      expect(html).not.toContain('PURO MALTE PREMIUM')
      expect(html).not.toContain('CHOPP ESPECIAL')
    })

    it('A16: página e seções públicas não exibem placeholders de desenvolvimento entre colchetes', () => {
      const contactHtml = renderToString(<ContactSection />)
      expect(contactHtml).not.toContain('[NÚMERO]')
      expect(contactHtml).not.toContain('[Endereço]')
      expect(contactHtml).not.toContain('[Horário de atendimento]')
      expect(contactHtml).not.toContain('[Instagram]')

      for (const item of faqItems) {
        expect(item.answer).not.toMatch(/\[.*\]/)
      }
    })
  })
})
