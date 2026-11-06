import { describe, expect, it } from 'vitest'
import { parseCmsDocument } from '../../../../shared/cms/validation-v2'
import { products } from '../../catalog/products'
import type { AdminCatalog } from '../catalog/types'
import { changeCarousel, eligibleBarrels } from './carouselModel'
import { buildInitialDocument } from './initialDocument'

const catalog = (): AdminCatalog => ({
  revision: 'r1',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      items: products.map((item, index) => ({ ...item, visible: index !== 2, variants: [] })),
    },
    {
      id: 'cachacas',
      name: 'Cachaças',
      items: [{ id: 'cachaca', name: 'Cachaça', description: '', visible: true, variants: [] }],
    },
  ],
})
function fixture() {
  const doc = buildInitialDocument()
  const module = doc.modules.find((item) => item.template === 'carousel')
  if (module?.template !== 'carousel') throw Error('Missing carousel')
  return { doc, module }
}
const entries = (doc: ReturnType<typeof buildInitialDocument>) => {
  const module = doc.modules.find((item) => item.template === 'carousel')
  if (module?.template !== 'carousel') throw Error('Missing carousel')
  return module.content.entries
}

describe('seleção editorial do catálogo', () => {
  it('lista somente referências visíveis de chopes; vazio não usa fixtures', () => {
    const items = eligibleBarrels(catalog())
    expect(items.some((item) => item.id === 'villa-alema' || item.id === 'cachaca')).toBe(false)
    expect(Object.keys(items[0])).toEqual(['id', 'name'])
    expect(eligibleBarrels({ revision: 'r1', categories: [] })).toEqual([])
  })
  it('adiciona somente itemId e media null, preservando conteúdo e documento original', () => {
    const { doc, module } = fixture()
    const before = structuredClone(doc)
    const next = changeCarousel(doc, module.id, {
      kind: 'add',
      itemId: 'dronken',
      catalog: catalog(),
    })
    expect(entries(next)).toEqual([{ itemId: 'dronken', media: null }])
    expect(parseCmsDocument(next).value).toBeDefined()
    expect(doc).toEqual(before)
    expect(next.modules.find((item) => item.id === module.id)?.content).toEqual({
      ...module.content,
      entries: entries(next),
    })
    expect(next.commercial).toEqual(doc.commercial)
  })
  it('recusa duplicatas, categoria errada, ocultos, temporários e IDs ausentes', () => {
    const { doc, module } = fixture()
    const next = changeCarousel(doc, module.id, {
      kind: 'add',
      itemId: 'dronken',
      catalog: catalog(),
    })
    for (const itemId of ['dronken', 'cachaca', 'villa-alema', 'tmp:123', 'ausente'])
      expect(changeCarousel(next, module.id, { kind: 'add', itemId, catalog: catalog() })).toBe(
        next,
      )
  })
  it('reordena sem perder referências de mídia existentes e remove sem tocar no catálogo', () => {
    const { doc, module } = fixture()
    const source = catalog(),
      before = structuredClone(source)
    module.content.entries = [
      { itemId: 'dronken', media: { id: 'preserved-media', alt: 'Preservado' } },
      { itemId: 'palato-beber', media: null },
    ]
    const next = changeCarousel(doc, module.id, {
      kind: 'move',
      itemId: 'palato-beber',
      direction: -1,
    })
    expect(entries(next)).toEqual([...module.content.entries].reverse())
    expect(
      entries(changeCarousel(next, module.id, { kind: 'remove', itemId: 'palato-beber' })),
    ).toEqual([module.content.entries[0]])
    expect(source).toEqual(before)
    expect(module.content.entries[0].itemId).toBe('dronken')
  })
  it('respeita limites de movimento e capacidade', () => {
    const { doc, module } = fixture()
    module.content.entries = Array.from({ length: 12 }, () => ({ itemId: 'dronken', media: null }))
    expect(
      changeCarousel(doc, module.id, { kind: 'add', itemId: 'palato-beber', catalog: catalog() }),
    ).toBe(doc)
    expect(changeCarousel(doc, module.id, { kind: 'move', itemId: 'dronken', direction: -1 })).toBe(
      doc,
    )
    expect(changeCarousel(doc, 'hero', { kind: 'remove', itemId: 'dronken' })).toBe(doc)
  })
})
