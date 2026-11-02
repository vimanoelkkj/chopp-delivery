import type { CmsDocumentV2 } from '../../shared/cms/v2'

const id = (n: number) => `module_12345678-1234-4123-8123-${String(n).padStart(12, '0')}`
/** Synthetic editorial fixture, used only in owned disposable tests/demo. Never shipped. */
export function previewFixture(): CmsDocumentV2 {
  return {
    schemaVersion: 2,
    commercial: { fulfillmentMode: 'delivery', whatsappNumber: null },
    modules: [
      {
        id: 'hero',
        template: 'hero',
        visible: true,
        navigation: 'none',
        content: {
          heading: 'Rascunho privado P4',
          summary: 'Prévia editorial de laboratório. Consulte disponibilidade no catálogo real.',
          media: null,
        },
      },
      {
        id: id(1),
        template: 'carousel',
        visible: true,
        navigation: 'primary',
        content: {
          heading: 'Barris do catálogo',
          lead: 'Seleção editorial com apresentações e valores da API comercial.',
          media: null,
          entries: [
            { itemId: 'dronken', media: null },
            { itemId: 'heineken', media: null },
          ],
        },
      },
      {
        id: id(2),
        template: 'ticker',
        visible: true,
        navigation: 'none',
        content: { items: ['Prévia editorial', 'Rascunho não publicado', 'Somente leitura'] },
      },
      {
        id: 'catalog',
        template: 'catalog',
        visible: true,
        navigation: 'primary',
        content: {
          heading: 'Catálogo ao vivo',
          intro: 'Preços e apresentações consultados exclusivamente na API comercial.',
        },
      },
      {
        id: id(3),
        template: 'faq',
        visible: true,
        navigation: 'primary',
        content: {
          heading: 'Perguntas do rascunho',
          items: [
            {
              question: 'Este conteúdo está publicado?',
              answer: 'Não. Esta é uma prévia privada de laboratório.',
            },
            {
              question: 'Os botões fazem pedidos?',
              answer: 'Não. As ações comerciais estão desativadas.',
            },
          ],
        },
      },
      {
        id: id(4),
        template: 'about',
        visible: true,
        navigation: 'none',
        content: {
          heading: 'História editorial',
          body: 'Texto de demonstração do rascunho. Nenhuma informação é publicada.',
          media: null,
        },
      },
      {
        id: id(5),
        template: 'how',
        visible: true,
        navigation: 'primary',
        content: {
          heading: 'Como consultar',
          steps: [
            { title: 'Consulte', body: 'Confira o catálogo disponível.' },
            { title: 'Combine', body: 'A prévia não envia pedidos.' },
          ],
        },
      },
      {
        id: id(6),
        template: 'highlight',
        visible: true,
        navigation: 'none',
        content: {
          heading: 'Destaque editorial',
          body: 'Conteúdo demonstrativo sem condição comercial adicionada.',
          media: null,
        },
      },
      {
        id: id(7),
        template: 'highlight',
        visible: true,
        navigation: 'none',
        content: {
          heading: 'Outro destaque',
          body: 'Segundo bloco com identidade de heading independente.',
          media: null,
        },
      },
      {
        id: 'contact',
        template: 'contact',
        visible: true,
        navigation: 'cta',
        content: {
          heading: 'Contato do rascunho',
          body: 'Nenhuma mensagem é enviada nesta prévia.',
        },
      },
    ],
  }
}
