import type { PublicCatalogV2 } from './types'

/**
 * Fixture de teste para prévia do catálogo expansível v2 (F3A.2).
 *
 * NOTA DE DEMONSTRAÇÃO:
 * Os 8 chopes base utilizam os nomes, descrições e preços históricos do seed (D1)
 * como referência comparativa.
 * Todos os produtos e variantes adicionais (o 9º chope Session IPA, barris de 7,5 L e 20 L,
 * múltiplas cachaças e múltiplos volumes de garrafa) são dados de TESTE / DEMONSTRAÇÃO
 * para validação do contrato v2 e NÃO constituem dados comerciais finais aprovados.
 */
export const EXPANDED_CATALOG_FIXTURE: PublicCatalogV2 = {
  revision: 'r201-preview-v2',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      sortOrder: 0,
      items: [
        // 1. Dronken (existente)
        {
          id: 'dronken',
          name: 'Dronken',
          description: 'Double Double',
          visible: true,
          sortOrder: 0,
          variants: [
            {
              code: '30',
              label: 'Barril 30 L',
              volumeMl: 30000,
              priceCents: 51000, // R$ 510,00
              sortOrder: 0,
            },
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 65000, // R$ 650,00
              sortOrder: 1,
            },
          ],
        },
        // 2. Palato Beber (existente)
        {
          id: 'palato-beber',
          name: 'Palato Beber',
          description: 'Premium Lager Pilsen',
          visible: true,
          sortOrder: 1,
          variants: [
            {
              code: '30',
              label: 'Barril 30 L',
              volumeMl: 30000,
              priceCents: 49000, // R$ 490,00
              sortOrder: 0,
            },
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 64000, // R$ 640,00
              sortOrder: 1,
            },
          ],
        },
        // 3. Villa Alemã (existente)
        {
          id: 'villa-alema',
          name: 'Villa Alemã',
          description: 'Chope',
          visible: true,
          sortOrder: 2,
          variants: [
            {
              code: '30',
              label: 'Barril 30 L',
              volumeMl: 30000,
              priceCents: 52000, // R$ 520,00
              sortOrder: 0,
            },
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 67000, // R$ 670,00
              sortOrder: 1,
            },
          ],
        },
        // 4. Krug Bier (existente)
        {
          id: 'krug-bier',
          name: 'Krug Bier',
          description: 'Chope',
          visible: true,
          sortOrder: 3,
          variants: [
            {
              code: '30',
              label: 'Barril 30 L',
              volumeMl: 30000,
              priceCents: 57000, // R$ 570,00
              sortOrder: 0,
            },
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 76000, // R$ 760,00
              sortOrder: 1,
            },
          ],
        },
        // 5. Brahma (existente — 30 L sem comercialização)
        {
          id: 'brahma',
          name: 'Brahma',
          description: 'Chope',
          visible: true,
          sortOrder: 4,
          variants: [
            {
              code: '30',
              label: 'Barril 30 L',
              volumeMl: 30000,
              priceCents: null, // Indisponível em 30 L
              sortOrder: 0,
            },
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 89000, // R$ 890,00
              sortOrder: 1,
            },
          ],
        },
        // 6. Kaiser (existente — 30 L sem comercialização)
        {
          id: 'kaiser',
          name: 'Kaiser',
          description: 'Chope',
          visible: true,
          sortOrder: 5,
          variants: [
            {
              code: '30',
              label: 'Barril 30 L',
              volumeMl: 30000,
              priceCents: null, // Indisponível em 30 L
              sortOrder: 0,
            },
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 89000, // R$ 890,00
              sortOrder: 1,
            },
          ],
        },
        // 7. Heineken (existente — 30 L sem comercialização)
        {
          id: 'heineken',
          name: 'Heineken',
          description: 'Chope',
          visible: true,
          sortOrder: 6,
          variants: [
            {
              code: '30',
              label: 'Barril 30 L',
              volumeMl: 30000,
              priceCents: null, // Indisponível em 30 L
              sortOrder: 0,
            },
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 99000, // R$ 990,00
              sortOrder: 1,
            },
          ],
        },
        // 8. Chopp de vinho (existente)
        {
          id: 'chopp-de-vinho',
          name: 'Chopp de vinho',
          description: 'Vinho',
          visible: true,
          sortOrder: 7,
          variants: [
            {
              code: '30',
              label: 'Barril 30 L',
              volumeMl: 30000,
              priceCents: 57000, // R$ 570,00
              sortOrder: 0,
            },
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 79000, // R$ 790,00
              sortOrder: 1,
            },
          ],
        },
        // 9. Chope NOVO de demonstração v2 com 4 tamanhos de barril (7,5 L, 20 L, 30 L e 50 L)
        {
          id: 'delegas-session-ipa',
          name: 'Delegas Session IPA (Demonstração)',
          description:
            'Lúpulos cítricos aromáticos, amargor moderado. Demonstração técnica com 4 tamanhos de barril.',
          visible: true,
          sortOrder: 8,
          variants: [
            {
              code: '7.5',
              label: 'Barril 7,5 L',
              volumeMl: 7500,
              priceCents: 16000, // R$ 160,00
              sortOrder: 0,
            },
            {
              code: '20',
              label: 'Barril 20 L',
              volumeMl: 20000,
              priceCents: 38000, // R$ 380,00
              sortOrder: 1,
            },
            {
              code: '30',
              label: 'Barril 30 L',
              volumeMl: 30000,
              priceCents: 54000, // R$ 540,00
              sortOrder: 2,
            },
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 84000, // R$ 840,00
              sortOrder: 3,
            },
          ],
        },
        // Produto oculto de demonstração (visible: false) — nunca deve sair no catálogo público
        {
          id: 'chope-imperial-stout-oculto',
          name: 'Chope Imperial Stout (Oculto)',
          description: 'Produto oculto para validação de filtro de catálogo.',
          visible: false,
          sortOrder: 9,
          variants: [
            {
              code: '50',
              label: 'Barril 50 L',
              volumeMl: 50000,
              priceCents: 95000,
              sortOrder: 0,
            },
          ],
        },
      ],
    },
    {
      id: 'cachacas',
      name: 'Cachaças',
      sortOrder: 1,
      items: [
        // Cachaça 1 (existente no cardápio Delegas: conservada em barril de umburana com jequitibá rosa, 700 ml, R$ 30)
        {
          id: 'cachaca-umburana',
          name: 'Cachaça',
          description: 'Conservada em barril de umburana com jequitibá rosa',
          visible: true,
          sortOrder: 0,
          variants: [
            {
              code: 'bottle-700',
              label: 'Garrafa 700 ml',
              volumeMl: 700,
              priceCents: 3000, // R$ 30,00 (preço registrado no catálogo original)
              sortOrder: 0,
            },
          ],
        },
        // Cachaça 2 (demonstração v2: teste de múltiplos volumes — 500 ml, 700 ml e 1.000 ml)
        {
          id: 'cachaca-delegas-prata',
          name: 'Cachaça Prata (Demonstração)',
          description:
            'Exemplo fictício para validação de produtos com múltiplos volumes de garrafa.',
          visible: true,
          sortOrder: 1,
          variants: [
            {
              code: 'bottle-500',
              label: 'Garrafa 500 ml',
              volumeMl: 500,
              priceCents: 3500, // R$ 35,00
              sortOrder: 0,
            },
            {
              code: 'bottle-700',
              label: 'Garrafa 700 ml',
              volumeMl: 700,
              priceCents: 4500, // R$ 45,00
              sortOrder: 1,
            },
            {
              code: 'bottle-1000',
              label: 'Garrafa 1.000 ml',
              volumeMl: 1000,
              priceCents: 6000, // R$ 60,00
              sortOrder: 2,
            },
          ],
        },
        // Cachaça 3 (demonstração v2: teste de volume único 750 ml)
        {
          id: 'cachaca-delegas-ouro',
          name: 'Cachaça Ouro (Demonstração)',
          description: 'Exemplo fictício para validação de variações de catálogo expansível.',
          visible: true,
          sortOrder: 2,
          variants: [
            {
              code: 'bottle-750',
              label: 'Garrafa 750 ml',
              volumeMl: 750,
              priceCents: 5800, // R$ 58,00
              sortOrder: 0,
            },
          ],
        },
        // Cachaça oculta (visible: false) — nunca deve sair no catálogo público
        {
          id: 'cachaca-safra-antiga-oculta',
          name: 'Cachaça Safra Especial (Oculta)',
          description: 'Garrafas de colecionador para teste de filtro.',
          visible: false,
          sortOrder: 3,
          variants: [
            {
              code: 'bottle-700',
              label: 'Garrafa 700 ml',
              volumeMl: 700,
              priceCents: 12000,
              sortOrder: 0,
            },
          ],
        },
      ],
    },
    // Categoria sem produtos visíveis (demonstração de omissão graciosa)
    {
      id: 'acessorios',
      name: 'Acessórios & Kits',
      sortOrder: 2,
      items: [
        {
          id: 'kit-copos-oculto',
          name: 'Kit de Tulipas (Oculto)',
          description: 'Item de teste oculto.',
          visible: false,
          sortOrder: 0,
          variants: [
            {
              code: 'kit-2',
              label: 'Kit 2 unidades',
              volumeMl: null,
              priceCents: 6500,
              sortOrder: 0,
            },
          ],
        },
      ],
    },
  ],
}

export const FIXTURE_PUBLIC_CATALOG_V2 = EXPANDED_CATALOG_FIXTURE

export const ORIGINAL_BEER_IDS = [
  'dronken',
  'palato-beber',
  'villa-alema',
  'krug-bier',
  'brahma',
  'kaiser',
  'heineken',
  'chopp-de-vinho',
] as const

export const FIXTURE_BARREL_SIZES_V2 = [
  { code: '7.5', label: 'Barril 7,5 L', volumeMl: 7500 },
  { code: '20', label: 'Barril 20 L', volumeMl: 20000 },
  { code: '30', label: 'Barril 30 L', volumeMl: 30000 },
  { code: '50', label: 'Barril 50 L', volumeMl: 50000 },
] as const

export const FIXTURE_BOTTLE_VOLUMES_V2 = [500, 700, 750, 1000] as const
