import { expect, it } from 'vitest'
import { validateExpanded } from '../../server/catalog-expansion/validation'

const input = (priceCents: unknown = 1, volumeMl: unknown = 30000) => ({
  revision: 'r1',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      items: [
        {
          id: 'old',
          name: 'Chope',
          description: '',
          visible: true,
          variants: [{ code: '30', label: '30 L', volumeMl, priceCents }],
        },
      ],
    },
  ],
})
it.each([NaN, Infinity, -Infinity, -1, 0, 1.1, '100', {}, true, Number.MAX_SAFE_INTEGER])(
  'rejeita centavos inadequados %s',
  (value) => {
    expect(validateExpanded(input(value), 'r1').fields).toBeDefined()
  },
)
it.each([NaN, Infinity, -1, 0, 1.1, '30000', Number.MAX_SAFE_INTEGER + 1, null])(
  'rejeita volume inadequado %s',
  (value) => {
    expect(validateExpanded(input(1, value), 'r1').fields).toBeDefined()
  },
)
it('refs duplicadas em produtos/variantes e sufixo newline são inválidos', () => {
  const body = input() as {
    revision: string
    categories: { id: string; name: string; items: unknown[] }[]
  }
  const ref = `tmp:${crypto.randomUUID()}`
  body.categories[0].items = [
    {
      clientId: ref,
      name: 'Novo',
      description: '',
      visible: true,
      variants: [{ clientId: ref, label: '30 L', volumeMl: 30000, priceCents: 1 }],
    },
  ]
  expect(validateExpanded(body, 'r1').fields).toBeDefined()
  body.categories[0].items = [
    {
      clientId: `${ref}\n`,
      name: 'Novo',
      description: '',
      visible: true,
      variants: [
        { clientId: `tmp:${crypto.randomUUID()}`, label: '30 L', volumeMl: 30000, priceCents: 1 },
      ],
    },
  ]
  expect(validateExpanded(body, 'r1').fields).toBeDefined()
})
