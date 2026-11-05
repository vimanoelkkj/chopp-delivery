import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PriceComparison } from './PriceComparison'
import type { Product } from './types'

const cell = (html: string, size: number) =>
  html.match(new RegExp(`<td[^>]*data-label="${size} L"[^>]*>([\\s\\S]*?)</td>`))?.[1] ?? ''

describe('unavailable barrel sizes in the public price table', () => {
  it.each([30, 50] as const)(
    'keeps %s L visible without a price or order action',
    (unavailable) => {
      const available = unavailable === 30 ? 50 : 30
      const product: Product = {
        id: 'sample',
        name: 'Sample',
        description: 'Chope',
        visible: true,
        prices: { 30: 450, 50: 750 },
      }
      product.prices[unavailable] = null
      const before = structuredClone(product)
      const html = renderToStaticMarkup(<PriceComparison products={[product]} />)
      expect(cell(html, unavailable)).toContain('Indispon\u00edvel')
      expect(cell(html, unavailable)).not.toMatch(/S\u00f3 em|R\$|<a\b|<button\b/)
      expect(html).toContain(`Barril ${unavailable} L`)
      expect(cell(html, available)).toContain(available === 30 ? '450' : '750')
      expect(cell(html, available)).toContain('Pedir')
      expect(product).toEqual(before)
    },
  )
})
