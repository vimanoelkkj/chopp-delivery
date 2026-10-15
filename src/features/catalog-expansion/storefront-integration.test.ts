import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sharedVariantColumns } from './columns'
import { ExpandableCatalogView } from './ExpandableCatalogView'
import { buildCatalogWhatsAppMessage } from './messages'
import type { CatalogItemV2, PublicCatalogV2 } from './types'

const connected = vi.hoisted(() => vi.fn(() => ({ state: { status: 'loading' }, retry: vi.fn() })))
vi.mock('./usePublicCatalog', () => ({ usePublicCatalog: connected }))
beforeEach(() => connected.mockClear())

const item = (
  id: string,
  code: string,
  label = 'Barril especial',
  volumeMl = 20000,
): CatalogItemV2 => ({
  id,
  name: id,
  description: 'Descrição',
  visible: true,
  variants: [{ code, label, volumeMl, priceCents: 12345 }],
})
describe('F3C.4: identidade e apresentação pública', () => {
  it('códigos opacos distintos compartilham coluna somente pela apresentação inequívoca', () => {
    expect(sharedVariantColumns([item('a', 'v_a'), item('b', 'v_b')])).toHaveLength(1)
    expect(sharedVariantColumns([item('a', 'same'), item('b', 'same', 'Outro', 7500)])).toBeNull()
  })
  it('preserva ordem e não colapsa variantes com o mesmo volume', () => {
    const a = item('a', 'v_a')
    a.variants.push({ code: 'v_b', label: 'Outra apresentação', volumeMl: 20000, priceCents: 9901 })
    const b = structuredClone(a)
    b.id = 'b'
    b.variants.reverse()
    expect(sharedVariantColumns([a, b])).toBeNull()
    expect(sharedVariantColumns([a])?.map((v) => v.label)).toEqual([
      'Barril especial',
      'Outra apresentação',
    ])
  })
  it('mensagem preserva nome, rótulo, volume e centavos; null não produz pedido', () => {
    const a = item('Chope (Novo)', 'v_a')
    expect(buildCatalogWhatsAppMessage(a.name, a.variants[0], 'L')).toBe(
      'Olá! Gostaria de pedir Chope (Novo), Barril especial · 20 L, por R$ 123,45.',
    )
    expect(
      buildCatalogWhatsAppMessage(a.name, { ...a.variants[0], priceCents: null }, 'L'),
    ).toBeNull()
  })
  it('landing controla loading/erro sem catálogo estático e preserva âncoras', () => {
    for (const status of ['loading', 'error'] as const) {
      const html = renderToStaticMarkup(
        createElement(ExpandableCatalogView, {
          state: { status },
          id: 'chopes',
          titleId: 'chopes-title',
          showCompliance: false,
        }),
      )
      expect(html).toContain('id="chopes"')
      expect(html).toContain('id="chopes-title"')
      expect(html).toContain(status === 'loading' ? 'Carregando catálogo' : 'Catálogo indisponível')
      expect(html).not.toContain('age-notice-hero')
      expect(html).not.toContain('R$')
      expect(connected).not.toHaveBeenCalled()
    }
  })
  it('fixture explícita preserva nomes e todas as variantes, sem convenções de demo', () => {
    const a = item('Chope (Novo)', 'v_a')
    const catalog: PublicCatalogV2 = {
      revision: 'opaque',
      categories: [{ id: 'chopes', name: 'Chopes', items: [a] }],
    }
    const html = renderToStaticMarkup(
      createElement(ExpandableCatalogView, { catalog, showCompliance: false }),
    )
    expect(html).toContain('Chope (Novo)')
    expect(html).toContain('20 L')
    expect(html).not.toContain('href="#"')
    expect(connected).not.toHaveBeenCalled()
  })
})

it('não confunde um volume contido em outro volume no rótulo', () => {
  const a = item('Chope', 'opaque', 'Barril 120 L', 20000)
  expect(buildCatalogWhatsAppMessage(a.name, a.variants[0], 'L')).toContain('Barril 120 L · 20 L')
})
it('512 variantes não multiplicam colunas por códigos opacos de outros itens', () => {
  const items = Array.from({ length: 64 }, (_, index) => ({
    ...item(`beer${index}`, 'unused'),
    variants: Array.from({ length: 8 }, (_, v) => ({
      code: `v_${index}_${v}`,
      label: `Barril ${v + 1} L`,
      volumeMl: (v + 1) * 1000,
      priceCents: 10000 + v,
    })),
  }))
  const catalog: PublicCatalogV2 = {
    revision: 'opaque',
    categories: [{ id: 'chopes', name: 'Chopes', items }],
  }
  const html = renderToStaticMarkup(
    createElement(ExpandableCatalogView, { catalog, showCompliance: false }),
  )
  expect((html.match(/<th scope="col"/g) ?? []).length).toBe(9)
  expect((html.match(/data-variant-code=/g) ?? []).length).toBe(1024)
  expect(connected).not.toHaveBeenCalled()
})
it('controle DEV de categorias vazias continua explícito, sem leitura de API', () => {
  const catalog: PublicCatalogV2 = {
    revision: 'opaque',
    categories: [{ id: 'future', name: 'Categoria futura', items: [] }],
  }
  expect(
    renderToStaticMarkup(
      createElement(ExpandableCatalogView, { catalog, omitEmptyCategories: false }),
    ),
  ).toContain('Categoria futura')
  expect(renderToStaticMarkup(createElement(ExpandableCatalogView, { catalog }))).not.toContain(
    'Categoria futura',
  )
  expect(connected).not.toHaveBeenCalled()
})
