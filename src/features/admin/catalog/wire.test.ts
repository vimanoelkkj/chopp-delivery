import { describe, expect, it } from 'vitest'
import { createMockGateway } from './mockGateway'
import { parseSaveResult, parseSnapshot, WireError } from './wire'

type Wire = ReturnType<typeof valid>

const valid = () => ({
  revision: 'r1',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      items: [
        {
          id: 'item_1',
          creationRef: 'tmp:a' as string | null,
          name: 'X',
          description: '',
          visible: true as unknown,
          variants: [
            {
              code: 'v_1',
              creationRef: null as string | null,
              label: 'L',
              volumeMl: 7500 as unknown,
              priceCents: 100 as unknown,
            },
          ],
        },
      ],
    },
  ],
})

const variantOf = (data: Wire) => data.categories[0].items[0].variants[0]

describe('wire: parseSnapshot', () => {
  it('aceita o formato esperado e trata creationRef omitido como null', () => {
    const data = valid()
    Reflect.deleteProperty(variantOf(data), 'creationRef')
    const catalog = parseSnapshot(data)
    expect(catalog.categories[0].items[0].variants[0].creationRef).toBeNull()
    expect(catalog.categories[0].items[0].creationRef).toBe('tmp:a')
  })

  it('aceita o snapshot do mock (mesma forma do contrato)', async () => {
    const snapshot = await createMockGateway(undefined, 0).load()
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toMatchObject(snapshot)
  })

  it.each<[string, (d: Wire) => void]>([
    ['revision ausente', (d) => void Reflect.deleteProperty(d, 'revision')],
    [
      'preço decimal',
      (d) => {
        variantOf(d).priceCents = 1.5
      },
    ],
    [
      'preço zero',
      (d) => {
        variantOf(d).priceCents = 0
      },
    ],
    [
      'preço em texto',
      (d) => {
        variantOf(d).priceCents = '1,00'
      },
    ],
    [
      'volume negativo',
      (d) => {
        variantOf(d).volumeMl = -1
      },
    ],
    [
      'item sem variantes',
      (d) => {
        d.categories[0].items[0].variants = []
      },
    ],
    [
      'visible em texto',
      (d) => {
        d.categories[0].items[0].visible = 'sim'
      },
    ],
    [
      'ids repetidos',
      (d) => {
        d.categories[0].items.push({ ...d.categories[0].items[0] })
      },
    ],
  ])('rejeita: %s', (_name, mutate) => {
    const data = valid()
    mutate(data)
    expect(() => parseSnapshot(data)).toThrow(WireError)
  })

  it('rejeita corpo que não é objeto', () => {
    for (const body of [null, 'x', 1, [], undefined])
      expect(() => parseSnapshot(body)).toThrow(WireError)
  })
})

describe('wire: parseSaveResult', () => {
  it('lê catalog + created', () => {
    const result = parseSaveResult({
      catalog: valid(),
      created: {
        items: [{ clientId: 'tmp:a', id: 'item_1' }],
        variants: [{ itemId: 'item_1', clientId: 'tmp:b', code: 'v_1' }],
      },
    })
    expect(result.created.items[0]).toEqual({ clientId: 'tmp:a', id: 'item_1' })
    expect(result.created.variants[0].code).toBe('v_1')
  })

  it('rejeita resposta sem created', () => {
    expect(() => parseSaveResult({ catalog: valid() })).toThrow(WireError)
  })
})
