/** Respostas válidas de GET /api/catalog para testes que controlam a rede do navegador. */
type Variant = { code: string; label: string; volumeMl: number; priceCents: number | null }
type Item = { id: string; name: string; description: string; visible: true; variants: Variant[] }

const standard = (id: string, name: string, p30: number | null, p50: number | null): Item => ({
  id,
  name,
  description: 'Chopp',
  visible: true,
  variants: [
    { code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: p30 },
    { code: '50', label: 'Barril de 50 L', volumeMl: 50000, priceCents: p50 },
  ],
})

export const standardCatalog = () => ({
  revision: 'r1',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      items: [
        standard('dronken', 'Dronken', 51000, 65000),
        standard('kaiser', 'Kaiser', null, 89000),
      ],
    },
    {
      id: 'cachacas',
      name: 'Cachaças',
      items: [
        {
          id: 'cachaca',
          name: 'Cachaça',
          description: 'Garrafa',
          visible: true,
          variants: [{ code: 'bottle', label: 'Garrafa', volumeMl: 700, priceCents: 3000 }],
        },
      ],
    },
  ],
})

/** Um chope fora do padrão 30/50 (muda o layout) com nome longo sem espaços e 8 apresentações. */
export const heterogeneousCatalog = () => {
  const catalog = standardCatalog()
  catalog.categories[0].items.push({
    id: 'especial',
    name: 'A'.repeat(70),
    description: 'B'.repeat(90),
    visible: true,
    variants: Array.from({ length: 8 }, (_, index) => ({
      code: `v_${index}`,
      label: `Barril especial número ${index + 1}`,
      volumeMl: (index + 1) * 2500,
      priceCents: 10000 + index * 111,
    })),
  })
  return catalog
}
