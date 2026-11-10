import { describe, expect, it } from 'vitest'
import { parseCmsDocument } from '../../../../shared/cms/validation-v2'
import {
  changeCarousel,
  clearEntryMedia,
  entryAltKey,
  setEntryAlt,
  setEntryMedia,
} from './carouselModel'
import { ALT_LIMIT, canSave, checkDocument, kindOf, problemKey } from './editModel'
import { buildInitialDocument } from './initialDocument'

// F4A.6.3: a imagem pertence à entrada (itemId); mover, editar ou remover outra não a desloca.
const A = 'media_12345678-1234-4123-8123-123456789012'
const B = 'media_87654321-1234-4123-8123-123456789012'
const catalog = {
  revision: 'r1',
  categories: [
    {
      id: 'chopes',
      name: 'Chopes',
      items: ['dronken', 'heineken', 'brahma'].map((id) => ({
        id,
        name: id,
        description: '',
        visible: true,
        variants: [],
      })),
    },
  ],
}
function start() {
  let doc = buildInitialDocument()
  const module = doc.modules.find((m) => m.template === 'carousel')
  if (module?.template !== 'carousel') throw Error('sem carrossel')
  for (const itemId of ['dronken', 'heineken', 'brahma'])
    doc = changeCarousel(doc, module.id, { kind: 'add', itemId, catalog })
  return { doc, moduleId: module.id }
}
const entriesOf = (doc: ReturnType<typeof buildInitialDocument>) => {
  const module = doc.modules.find((m) => m.template === 'carousel')
  if (module?.template !== 'carousel') throw Error('sem carrossel')
  return module.content.entries
}
const mediaOf = (doc: ReturnType<typeof buildInitialDocument>) =>
  Object.fromEntries(entriesOf(doc).map((e) => [e.itemId, e.media]))

describe('mídia por entrada do carrossel', () => {
  it('associa pelo itemId, começa sem texto alternativo e não mexe nas outras entradas', () => {
    const { doc, moduleId } = start()
    const next = setEntryMedia(doc, moduleId, 'heineken', A)
    expect(mediaOf(next)).toEqual({
      dronken: null,
      heineken: { id: A, alt: '' },
      brahma: null,
    })
    expect(setEntryMedia(doc, moduleId, 'inexistente', A)).toBe(doc)
  })

  it('reordenar, editar o alt de outra entrada ou remover outra entrada preserva cada imagem', () => {
    const { doc, moduleId } = start()
    let next = setEntryMedia(setEntryMedia(doc, moduleId, 'dronken', A), moduleId, 'brahma', B)
    next = setEntryAlt(next, moduleId, 'dronken', 'Barril Dronken')
    next = changeCarousel(next, moduleId, { kind: 'move', itemId: 'brahma', direction: -1 })
    next = changeCarousel(next, moduleId, { kind: 'move', itemId: 'brahma', direction: -1 })
    expect(entriesOf(next).map((e) => e.itemId)).toEqual(['brahma', 'dronken', 'heineken'])
    expect(mediaOf(next)).toEqual({
      brahma: { id: B, alt: '' },
      dronken: { id: A, alt: 'Barril Dronken' },
      heineken: null,
    })
    next = changeCarousel(next, moduleId, { kind: 'remove', itemId: 'heineken' })
    expect(mediaOf(next)).toEqual({
      brahma: { id: B, alt: '' },
      dronken: { id: A, alt: 'Barril Dronken' },
    })
  })

  it('trocar mantém o texto alternativo para conferência; remover só desassocia', () => {
    const { doc, moduleId } = start()
    let next = setEntryAlt(setEntryMedia(doc, moduleId, 'dronken', A), moduleId, 'dronken', 'Texto')
    next = setEntryMedia(next, moduleId, 'dronken', B)
    expect(mediaOf(next).dronken).toEqual({ id: B, alt: 'Texto' })
    next = clearEntryMedia(next, moduleId, 'dronken')
    expect(mediaOf(next).dronken).toBeNull()
    expect(entriesOf(next).map((e) => e.itemId)).toEqual(['dronken', 'heineken', 'brahma'])
    // Sem imagem, editar o alt não cria uma.
    expect(setEntryAlt(next, moduleId, 'dronken', 'x')).toBe(next)
  })

  it('texto alternativo longo demais vira problema do campo da própria entrada e bloqueia salvar', () => {
    const { doc, moduleId } = start()
    const next = setEntryAlt(
      setEntryMedia(doc, moduleId, 'heineken', A),
      moduleId,
      'heineken',
      'x'.repeat(ALT_LIMIT + 1),
    )
    const check = checkDocument(next)
    expect(kindOf(entryAltKey('heineken'))).toBe('alt')
    expect(check.problems.has(problemKey(moduleId, entryAltKey('heineken')))).toBe(true)
    expect(check.problems.has(problemKey(moduleId, entryAltKey('dronken')))).toBe(false)
    expect(canSave(check)).toBe(false)
  })

  it('o rascunho com imagem e alt vazio é aceito pelo contrato; sem imagem continua válido', () => {
    const { doc, moduleId } = start()
    const withMedia = setEntryMedia(doc, moduleId, 'dronken', A)
    expect(parseCmsDocument(withMedia, 'draft').value).toBeTruthy()
    expect(canSave(checkDocument(withMedia))).toBe(true)
    expect(canSave(checkDocument(doc))).toBe(true)
    const described = setEntryAlt(withMedia, moduleId, 'dronken', 'Barril de chopp Dronken')
    expect(parseCmsDocument(described, 'draft').value).toBeTruthy()
  })
})
