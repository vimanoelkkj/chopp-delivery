import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BarrelCarousel3D } from './BarrelCarousel3D'
import { parseExpandedCatalog } from './expanded-api'
import type { PublicItem } from './presentation'

// F4A.6.4D: imagem principal do produto (`image` do catálogo público) e a precedência na vitrine.
const MEDIA_A = 'media_12345678-1234-4123-8123-123456789012'
const MEDIA_B = 'media_87654321-1234-4123-8123-123456789012'
const MEDIA_E = 'media_11111111-1234-4123-8123-123456789012'
const item = (id: string, name: string, image?: { id: string; alt: string }): PublicItem => ({
  id,
  name,
  description: `Descrição ${name}`,
  visible: true,
  variants: [{ code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 50000 }],
  ...(image ? { image } : {}),
})
const render = (
  items: PublicItem[],
  editorial?: (id: string) => { id: string; alt: string } | null | undefined,
) => renderToStaticMarkup(<BarrelCarousel3D items={items} publishedMedia={editorial} />)
const cards = (html: string) =>
  html
    .split('<article')
    .slice(1)
    .map((card) => card.split('</article>')[0])
const mediaOf = (card: string) =>
  [...card.matchAll(/\/api\/site\/media\/([^"/]+)\/section/g)].map((m) => m[1])

describe('parser do catálogo público: image opcional', () => {
  const payload = (image?: unknown) => ({
    revision: 'r1',
    categories: [
      {
        id: 'chopes',
        name: 'Chopes',
        items: [
          {
            id: 'dronken',
            name: 'Dronken',
            description: '',
            visible: true,
            variants: [{ code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 50000 }],
            ...(image === undefined ? {} : { image }),
          },
        ],
      },
    ],
  })
  const imageOf = (value: unknown) =>
    (parseExpandedCatalog(value).expanded.categories[0].items[0] as PublicItem).image

  it('mantém uma imagem válida', () => {
    expect(imageOf(payload({ id: MEDIA_A, alt: 'Dronken em aço' }))).toEqual({
      id: MEDIA_A,
      alt: 'Dronken em aço',
    })
  })

  it('sem imagem, o item não ganha a chave `image`', () => {
    const item = parseExpandedCatalog(payload()).expanded.categories[0].items[0]
    expect(Object.hasOwn(item, 'image')).toBe(false)
  })

  it.each([
    ['null', null],
    ['texto', 'x'],
    ['lista', []],
    ['chave extra', { id: MEDIA_A, alt: 'ok', url: '/x' }],
    ['sem alt', { id: MEDIA_A }],
    ['id inválido', { id: 'media_x', alt: 'ok' }],
    ['id de outro tipo', { id: '/etc/passwd', alt: 'ok' }],
    ['alt vazio', { id: MEDIA_A, alt: '   ' }],
    ['alt longo', { id: MEDIA_A, alt: 'x'.repeat(201) }],
    ['alt numérico', { id: MEDIA_A, alt: 5 }],
  ])('imagem inválida (%s) é descartada sem derrubar o catálogo', (_name, image) => {
    expect(imageOf(payload(image))).toBeUndefined()
    expect(parseExpandedCatalog(payload(image)).expanded.categories[0].items).toHaveLength(1)
  })
})

describe('precedência da imagem no carrossel', () => {
  it('sem nenhuma imagem a marcação é idêntica à anterior (foto aprovada e silhueta)', () => {
    const items = [item('dronken', 'Dronken'), item('item_novo', 'Produto Novo')]
    const baseline = render(items)
    expect(render(items, () => null)).toBe(baseline)
    expect(baseline).not.toContain('/api/site/media/')
    expect(baseline).toContain('dronken.webp')
    expect(baseline).toContain('data-keg-placeholder')
  })

  it('a imagem principal vai para o produto certo, em qualquer ordem, mantendo o fallback', () => {
    const a = item('dronken', 'Dronken', { id: MEDIA_A, alt: 'Foto do Dronken' })
    const b = item('item_novo', 'Produto Novo', { id: MEDIA_B, alt: 'Foto do novo' })
    for (const items of [
      [a, b],
      [b, a],
    ]) {
      const byName = Object.fromEntries(
        cards(render(items)).map((card) => [
          card.includes('Produto Novo') ? 'novo' : 'dronken',
          mediaOf(card),
        ]),
      )
      expect(byName).toEqual({ dronken: [MEDIA_A], novo: [MEDIA_B] })
    }
    // Enquanto carrega, a foto aprovada (Dronken) e a silhueta (novo) continuam montadas.
    const [first, second] = cards(render([a, b]))
    expect(first).toContain('dronken.webp')
    expect(second).toContain('data-keg-placeholder')
  })

  it('a imagem editorial vence a principal, e só no carrossel', () => {
    const a = item('dronken', 'Dronken', { id: MEDIA_A, alt: 'Principal do Dronken' })
    const b = item('heineken', 'Heineken', { id: MEDIA_B, alt: 'Principal da Heineken' })
    const editorial = (id: string) => (id === 'dronken' ? { id: MEDIA_E, alt: 'Editorial' } : null)
    const [dronken, heineken] = cards(render([a, b], editorial))
    expect(mediaOf(dronken)).toEqual([MEDIA_E]) // a principal nem é requisitada
    expect(mediaOf(heineken)).toEqual([MEDIA_B]) // sem editorial, vale a principal
    // Sem a editorial (outra apresentação), a mesma imagem principal vale.
    expect(mediaOf(cards(render([a]))[0])).toEqual([MEDIA_A])
  })

  it('enquanto o conteúdo editorial carrega, a principal não é usada nem requisitada', () => {
    const a = item('dronken', 'Dronken', { id: MEDIA_A, alt: 'Principal' })
    const html = renderToStaticMarkup(<BarrelCarousel3D items={[a]} productImages={false} />)
    expect(html).not.toContain('/api/site/media/')
    expect(html).toContain('dronken.webp')
    // A editorial continua valendo, com ou sem a principal.
    expect(
      renderToStaticMarkup(
        <BarrelCarousel3D
          items={[a]}
          productImages={false}
          publishedMedia={() => ({ id: MEDIA_E, alt: 'Editorial' })}
        />,
      ),
    ).toContain(MEDIA_E)
  })

  it('o alt anunciado só existe depois de carregar, e vem do próprio produto', () => {
    const html = render([item('dronken', 'Dronken', { id: MEDIA_A, alt: 'Alt do Dronken' })])
    expect(html).not.toContain('Alt do Dronken') // carregando: fora da árvore de acessibilidade
    expect(html).toContain('aria-hidden="true"')
  })

  it('produto oculto ou ausente do catálogo não gera nenhuma requisição de mídia', () => {
    // O catálogo público já omite o produto oculto; a vitrine só resolve imagem do que recebe.
    const visible = item('dronken', 'Dronken', { id: MEDIA_A, alt: 'Foto' })
    const html = render([visible], (id) => (id === 'oculto' ? { id: MEDIA_B, alt: 'x' } : null))
    expect(html).not.toContain(MEDIA_B)
    expect([...new Set(mediaOf(html))]).toEqual([MEDIA_A])
  })
})
