import { faqItems } from '@/features/faq/faq-items'
import type { CmsDocumentV2 } from '../../../../shared/cms/v2'

/**
 * Documento inicial do CMS v2 (`startV2`). O contrato exige que o cliente envie o documento; ele não
 * inventa conteúdo: cada texto abaixo é o texto que a homepage já mostra hoje quando não há conteúdo
 * editorial (um teste compara com a renderização real dos componentes, para não haver divergência).
 *
 * A vitrine começa sem barris (`entries: []`): quais barris aparecem é decisão editorial futura, e o
 * catálogo comercial continua sendo a única fonte de preços e variantes.
 */
export const INITIAL_COPY = {
  hero: {
    heading: 'O melhor do chopp. Direto para o seu evento.',
    summary:
      'Barris em aço inox escovado das melhores cervejarias artesanais e tradicionais. Receba com chopeira elétrica regulada pronta para servir. Entrega e instalação profissional em São João del-Rei e região.',
  },
  carousel: {
    heading: 'Escolha seu barril em 3D',
    lead: 'Navegue pelos barris reais da nossa câmara fria. Arraste horizontalmente ou use as setas para inspecionar detalhes, litragens e valores de cada cervejaria.',
  },
  ticker: ['Chope gelado', 'Barril 30 L', 'Barril 50 L', '100% Delivery', 'Instalação inclusa'],
  catalog: {
    heading: 'Nossos chopes e litragens',
    intro: 'Consulte os valores dos barris de 30 e de 50 litros.',
  },
  how: {
    heading: 'Como funciona a entrega',
    steps: [
      {
        title: 'Escolha o chopp',
        body: 'Selecione o estilo e a cervejaria desejada, definindo entre 30L ou 50L conforme o número de convidados.',
      },
      {
        title: 'Dados e tomada',
        body: 'Informe data, horário, endereço do evento e se a tomada disponível é 110V ou 220V para a chopeira.',
      },
      {
        title: 'Instalação inclusa',
        body: 'Nossa equipe posiciona o barril, liga a chopeira elétrica profissional, calibra o CO2 e deixa tudo pronto.',
      },
      {
        title: 'Aproveite o chopp',
        body: 'Chopp sempre gelado do primeiro ao último copo. Após o evento, nós recolhemos o equipamento sem complicações.',
      },
    ],
  },
  about: {
    heading: 'O chopp como centro da sua celebração',
    body: 'Somos especialistas dedicados na cadeia do barril de chopp e também entregamos cachaça em garrafa. Mantemos nossa câmara fria estritamente controlada para que a carbonatação, a espuma cremosa e a frescura de cada cervejaria cheguem intactas ao seu evento.',
  },
  highlight: {
    heading: 'Condições especiais para eventos',
    body: 'Chopeira elétrica profissional inclusa e instalação técnica em São João del-Rei e região. Consulte pacotes e datas para seu evento via WhatsApp.',
  },
  faq: { heading: 'Perguntas frequentes' },
  contact: {
    heading: 'Bora pedir?',
    body: 'Conte o que precisa e a gente responde com as opções e os valores.',
  },
} as const

/** Quantas seções o documento inicial cria (para a tela dizer o que será criado). */
export const INITIAL_SECTION_COUNT = 9

/** Os ids opcionais seguem `module_<uuid v4>`; os obrigatórios têm id fixo (regra do contrato). */
export function buildInitialDocument(
  newId: () => string = () => `module_${crypto.randomUUID()}`,
): CmsDocumentV2 {
  const c = INITIAL_COPY
  return {
    schemaVersion: 2,
    commercial: { fulfillmentMode: 'delivery', whatsappNumber: null },
    modules: [
      {
        id: 'hero',
        template: 'hero',
        visible: true,
        navigation: 'none',
        content: { heading: c.hero.heading, summary: c.hero.summary, media: null },
      },
      {
        id: newId(),
        template: 'carousel',
        visible: true,
        navigation: 'primary',
        content: { heading: c.carousel.heading, lead: c.carousel.lead, media: null, entries: [] },
      },
      {
        id: newId(),
        template: 'ticker',
        visible: true,
        navigation: 'none',
        content: { items: [...c.ticker] },
      },
      {
        id: 'catalog',
        template: 'catalog',
        visible: true,
        navigation: 'primary',
        content: { heading: c.catalog.heading, intro: c.catalog.intro },
      },
      {
        id: newId(),
        template: 'how',
        visible: true,
        navigation: 'primary',
        content: { heading: c.how.heading, steps: c.how.steps.map((step) => ({ ...step })) },
      },
      {
        id: newId(),
        template: 'about',
        visible: true,
        navigation: 'none',
        content: { heading: c.about.heading, body: c.about.body, media: null },
      },
      {
        id: newId(),
        template: 'highlight',
        visible: true,
        navigation: 'none',
        content: { heading: c.highlight.heading, body: c.highlight.body, media: null },
      },
      {
        id: newId(),
        template: 'faq',
        visible: true,
        navigation: 'primary',
        content: {
          heading: c.faq.heading,
          items: faqItems.map(({ question, answer }) => ({ question, answer })),
        },
      },
      {
        id: 'contact',
        template: 'contact',
        visible: true,
        navigation: 'cta',
        content: { heading: c.contact.heading, body: c.contact.body },
      },
    ],
  }
}
