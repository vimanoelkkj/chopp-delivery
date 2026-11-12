import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BarrelCarousel3D } from './BarrelCarousel3D'
import type { PublicItem } from './presentation'

// F4A.6.2: a imagem editorial é resolvida pelo itemId e nunca substitui a foto atual sem carregar.
const MEDIA_A = 'media_12345678-1234-4123-8123-123456789012'
const MEDIA_B = 'media_87654321-1234-4123-8123-123456789012'
const item = (id: string, name: string): PublicItem => ({
  id,
  name,
  description: `Descrição ${name}`,
  visible: true,
  variants: [{ code: '30', label: 'Barril de 30 L', volumeMl: 30000, priceCents: 50000 }],
})
const A = item('dronken', 'Dronken')
const B = item('item_novo', 'Produto Novo') // sem foto própria: silhueta neutra
const render = (
  items: PublicItem[],
  publishedMedia?: (id: string) => { id: string; alt: string } | null | undefined,
) => renderToStaticMarkup(<BarrelCarousel3D items={items} publishedMedia={publishedMedia} />)
const cards = (html: string) =>
  html
    .split('<article')
    .slice(1)
    .map((card) => card.split('</article>')[0])
const mediaOf = (card: string) => card.match(/\/api\/site\/media\/([^"/]+)\/section/)?.[1]

describe('mídia editorial no carrossel', () => {
  it('sem mídia editorial a marcação é idêntica à anterior (foto atual e silhueta)', () => {
    const baseline = render([A, B])
    expect(render([A, B], () => null)).toBe(baseline)
    expect(render([A, B], () => undefined)).toBe(baseline)
    expect(baseline).not.toContain('/api/site/media/')
    expect(baseline).toContain('dronken.webp') // Dronken: foto atual
    expect(baseline).toContain('data-keg-placeholder') // produto novo: silhueta neutra
  })

  it('a imagem vai para o cartão do próprio itemId, em qualquer ordem', () => {
    const lookup = (id: string) =>
      id === 'dronken'
        ? { id: MEDIA_A, alt: 'Dronken editorial' }
        : id === 'item_novo'
          ? { id: MEDIA_B, alt: 'Novo editorial' }
          : null
    for (const items of [
      [A, B],
      [B, A],
    ]) {
      const html = render(items, lookup)
      const byName = Object.fromEntries(
        cards(html).map((card) => [
          card.includes('Produto Novo') ? 'novo' : 'dronken',
          mediaOf(card),
        ]),
      )
      expect(byName).toEqual({ dronken: MEDIA_A, novo: MEDIA_B })
    }
  })

  it('só o produto com mídia recebe imagem; o outro mantém foto ou silhueta', () => {
    const html = render([A, B], (id) => (id === 'item_novo' ? { id: MEDIA_B, alt: 'Novo' } : null))
    const [dronken, novo] = cards(html)
    expect(mediaOf(dronken)).toBeUndefined()
    expect(dronken).toContain('dronken.webp')
    expect(mediaOf(novo)).toBe(MEDIA_B)
  })

  it('a foto atual (fallback) fica montada até a imagem carregar e o alt só é anunciado depois', () => {
    const html = render([A], () => ({ id: MEDIA_A, alt: 'Dronken editorial' }))
    expect(html).toContain('dronken.webp') // fallback presente
    expect(html).toContain('aria-hidden="true"') // imagem publicada ainda não anunciada
    expect(html).not.toContain('Dronken editorial')
  })

  it('id de mídia inválido ou de produto ausente é ignorado, sem requisição', () => {
    expect(render([A], () => ({ id: 'media_invalido', alt: 'x' }))).not.toContain(
      '/api/site/media/',
    )
    expect(render([A], (id) => (id === 'outro' ? { id: MEDIA_A, alt: 'x' } : null))).not.toContain(
      '/api/site/media/',
    )
  })

  it('o selo de disponibilidade fica acima da imagem publicada', () => {
    const css = readFileSync('src/features/catalog/BarrelCarousel3D.module.css', 'utf8')
    expect(css).toMatch(/\.badge \{[^}]*z-index: 3/)
  })
})
