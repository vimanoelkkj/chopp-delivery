import { describe, expect, it } from 'vitest'
import { validText } from '../../server/admin-catalog/validation'
import { validateExpanded } from '../../server/catalog-expansion/validation'

/**
 * Quais caracteres escondidos num rótulo podem chegar ao D1 pelo contrato de escrita da v2? A
 * vitrine não depende disto (a gramática de volumes é estrita para QUALQUER texto), mas o teste
 * documenta a primeira linha de defesa: controles bidirecionais não são gravados.
 */
describe('rótulos: o que o contrato de escrita aceita e recusa', () => {
  it.each([
    ['U+200E (LRM)', '‎'],
    ['U+200F (RLM)', '‏'],
    ['U+202E (RLO)', '‮'],
    ['U+2066 (LRI)', '⁦'],
    ['U+0000 (NUL)', '\u0000'],
    ['U+001F (controle)', '\u001F'],
  ])('recusa %s', (_name, mark) => {
    expect(validText(`Barril -${mark}20 L`, true)).toBe(false)
  })

  it.each([
    ['U+2063 (separador invisível)', '⁣'],
    ['U+200B (ZWSP)', '​'],
    ['U+2060 (word joiner)', '⁠'],
    ['U+00AD (hífen opcional)', '­'],
    ['U+2212 (menos matemático)', '−'],
  ])('aceita %s (por isso a vitrine tem de ser estrita sozinha)', (_name, mark) => {
    expect(validText(`Barril -${mark} 20 L`, true)).toBe(true)
  })

  it('o PUT v2 devolve erro de campo para o rótulo com controle bidirecional', () => {
    const ref = () => `tmp:${crypto.randomUUID()}`
    const body = (label: string) => ({
      revision: 'r1',
      categories: [
        {
          id: 'chopes',
          name: 'Chopes',
          items: [
            {
              clientId: ref(),
              name: 'Chope',
              description: '',
              visible: false,
              variants: [{ clientId: ref(), label, volumeMl: 20000, priceCents: 12345 }],
            },
          ],
        },
        { id: 'cachacas', name: 'Cachaças', items: [] },
      ],
    })
    expect(validateExpanded(body('Barril -‎20 L'), 'r1').fields).toBeDefined()
    expect(validateExpanded(body('Barril -⁣ 20 L'), 'r1').fields).toBeUndefined()
  })
})
