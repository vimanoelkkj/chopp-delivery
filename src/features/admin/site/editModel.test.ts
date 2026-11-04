import { describe, expect, it } from 'vitest'
import { CMS_LIMITS } from '../../../../shared/cms/common'
import type { CmsDocumentV2 } from '../../../../shared/cms/v2'
import { parseCmsDocument } from '../../../../shared/cms/validation-v2'
import {
  ALT_LIMIT,
  addItem,
  canSave,
  checkDocument,
  clearMedia,
  countChars,
  fieldProblem,
  hasMediaSlot,
  isDirty,
  kindOf,
  listLength,
  problemKey,
  readField,
  readMedia,
  removeItem,
  setField,
  setMedia,
  setVisible,
} from './editModel'
import { buildInitialDocument } from './initialDocument'

const doc = () => buildInitialDocument()
const byTemplate = (d: CmsDocumentV2, template: string) => {
  const found = d.modules.find((m) => m.template === template)
  if (!found) throw new Error(template)
  return found
}
const accepted = (d: CmsDocumentV2) => parseCmsDocument(d, 'draft').value !== undefined

describe('campos de texto', () => {
  it('troca título, texto, itens de lista e FAQ e o contrato continua aceitando', () => {
    let d = doc()
    const hero = byTemplate(d, 'hero')
    const faq = byTemplate(d, 'faq')
    const ticker = byTemplate(d, 'ticker')
    const how = byTemplate(d, 'how')
    d = setField(d, hero.id, 'heading', 'Novo título da abertura')
    d = setField(d, hero.id, 'summary', 'Primeira linha.\nSegunda linha.')
    d = setField(d, faq.id, 'items.0.question', 'Pergunta nova?')
    d = setField(d, faq.id, 'items.0.answer', 'Resposta nova.')
    d = setField(d, ticker.id, 'items.1', 'Frase nova')
    d = setField(d, how.id, 'steps.0.title', 'Passo novo')
    d = setField(d, how.id, 'steps.0.body', 'Texto do passo novo.')
    expect(readField(byTemplate(d, 'hero'), 'heading')).toBe('Novo título da abertura')
    expect(readField(byTemplate(d, 'faq'), 'items.0.question')).toBe('Pergunta nova?')
    expect(readField(byTemplate(d, 'ticker'), 'items.1')).toBe('Frase nova')
    expect(accepted(d)).toBe(true)
    expect(canSave(checkDocument(d))).toBe(true)
  })

  it('não altera o original (cópia local) nem nada além do campo escolhido', () => {
    const original = doc()
    const snapshot = JSON.stringify(original)
    const hero = byTemplate(original, 'hero')
    const edited = setField(original, hero.id, 'heading', 'Outro')
    expect(JSON.stringify(original)).toBe(snapshot)
    const strip = (d: CmsDocumentV2, id: string) =>
      JSON.stringify({ ...d, modules: d.modules.filter((m) => m.id !== id) })
    expect(strip(edited, hero.id)).toBe(strip(original, hero.id))
    const { content: before, ...beforeRest } = hero
    const { content: after, ...afterRest } = byTemplate(edited, 'hero')
    expect(afterRest).toEqual(beforeRest)
    expect(after).toEqual({ ...before, heading: 'Outro' })
  })

  it('recusa caminhos que não são texto editorial: mídia, entradas do carrossel, ids, tipo', () => {
    const d = doc()
    const hero = byTemplate(d, 'hero')
    const carousel = byTemplate(d, 'carousel')
    for (const key of ['media', 'id', 'template', 'visible', 'items.0', 'entries', 'nope.deep']) {
      expect(setField(d, hero.id, key, 'x')).toBe(d)
    }
    expect(setField(d, carousel.id, 'entries', 'x')).toBe(d)
    expect(setField(d, 'module_inexistente', 'heading', 'x')).toBe(d)
  })

  it('classifica linha única e texto longo como o contrato (120 e 2000)', () => {
    expect(kindOf('heading')).toBe('heading')
    expect(kindOf('items.2')).toBe('heading')
    expect(kindOf('items.2.question')).toBe('heading')
    expect(kindOf('steps.0.title')).toBe('heading')
    for (const key of ['summary', 'lead', 'intro', 'body', 'items.2.answer', 'steps.0.body'])
      expect(kindOf(key)).toBe('text')
  })
})

describe('limites do contrato', () => {
  it('120 caracteres passam e 121 não, contando pontos de código (emoji vale 1)', () => {
    expect(fieldProblem('a'.repeat(CMS_LIMITS.heading), 'heading')).toBeNull()
    expect(fieldProblem('a'.repeat(CMS_LIMITS.heading + 1), 'heading')).toMatch(/Sobra 1 caractere/)
    expect(fieldProblem('🍺'.repeat(CMS_LIMITS.heading), 'heading')).toBeNull()
    expect(countChars('🍺🍺')).toBe(2)
  })

  it('2000 caracteres passam no texto longo e 2001 não', () => {
    expect(fieldProblem('b'.repeat(CMS_LIMITS.text), 'text')).toBeNull()
    expect(fieldProblem('b'.repeat(CMS_LIMITS.text + 5), 'text')).toMatch(/Sobram 5 caracteres/)
  })

  it('recusa < > e links, com a mesma regra do contrato', () => {
    expect(fieldProblem('olá <b>', 'text')).toMatch(/< e >/)
    for (const bad of ['veja https://x.com', 'www.site.com', 'mailto:a@b.c', '//cdn.x', 'tel:123'])
      expect(fieldProblem(bad, 'text')).toMatch(/links/)
    expect(fieldProblem('Entrega às 18:30, sem pressa', 'text')).toBeNull()
  })

  it('quebra de linha só vale no texto longo; controles invisíveis são recusados', () => {
    expect(fieldProblem('a\nb', 'text')).toBeNull()
    expect(fieldProblem('a\nb', 'heading')).toMatch(/uma linha/)
    expect(fieldProblem('a\u0007b', 'text')).toMatch(/caracteres que o site não aceita/)
  })

  it('texto vazio é aceito em rascunho (a exigência é só na publicação)', () => {
    expect(fieldProblem('', 'heading')).toBeNull()
    expect(canSave(checkDocument(setField(doc(), 'hero', 'heading', '')))).toBe(true)
  })

  it('o documento inteiro tem limite de bytes: o excesso vira problema do documento', () => {
    let d = doc()
    // 24 seções de texto longo não existem; enche as respostas do FAQ até passar de 64 KiB
    const faq = byTemplate(d, 'faq')
    for (let i = 0; i < CMS_LIMITS.list; i++) d = addItem(d, faq.id)
    const big = 'ç'.repeat(CMS_LIMITS.text)
    for (let i = 0; i < CMS_LIMITS.list; i++) d = setField(d, faq.id, `items.${i}.answer`, big)
    const how = byTemplate(d, 'how')
    for (let i = 0; i < CMS_LIMITS.list; i++) d = addItem(d, how.id)
    for (let i = 0; i < CMS_LIMITS.list; i++) d = setField(d, how.id, `steps.${i}.body`, big)
    const check = checkDocument(d)
    expect(check.problems.size).toBe(0)
    expect(check.documentProblem).toMatch(/tamanho total/)
    expect(canSave(check)).toBe(false)
  })

  it('aponta cada campo com problema e a seção a que ele pertence', () => {
    const hero = byTemplate(doc(), 'hero')
    const d = setField(doc(), hero.id, 'heading', 'x'.repeat(200))
    const check = checkDocument(d)
    expect([...check.problems.keys()]).toEqual([problemKey(hero.id, 'heading')])
    expect(check.sections.has(hero.id)).toBe(true)
    expect(canSave(check)).toBe(false)
  })
})

describe('visibilidade', () => {
  it('seção opcional pode ser ocultada e mostrada de novo', () => {
    const d = doc()
    const about = byTemplate(d, 'about')
    const hidden = setVisible(d, about.id, false)
    expect(byTemplate(hidden, 'about').visible).toBe(false)
    expect(accepted(hidden)).toBe(true)
    expect(isDirty(d, hidden)).toBe(true)
    expect(isDirty(d, setVisible(hidden, about.id, true))).toBe(false)
  })

  it('seções obrigatórias nunca são ocultadas, mesmo por chamada direta', () => {
    const d = doc()
    for (const template of ['hero', 'catalog', 'contact']) {
      const module = byTemplate(d, template)
      expect(setVisible(d, module.id, false)).toBe(d)
    }
  })
})

describe('listas editoriais', () => {
  it('adiciona item em branco (aceito em rascunho) e respeita o limite de 12', () => {
    let d = doc()
    const faq = byTemplate(d, 'faq')
    const before = listLength(faq)
    d = addItem(d, faq.id)
    expect(listLength(byTemplate(d, 'faq'))).toBe(before + 1)
    expect(readField(byTemplate(d, 'faq'), `items.${before}.question`)).toBe('')
    expect(accepted(d)).toBe(true)
    while (listLength(byTemplate(d, 'faq')) < CMS_LIMITS.list) d = addItem(d, faq.id)
    const full = d
    expect(addItem(full, faq.id)).toBe(full)
  })

  it('remove o item pedido, na ordem, e ignora índices inválidos', () => {
    let d = doc()
    const ticker = byTemplate(d, 'ticker')
    const items = (byTemplate(d, 'ticker').content as { items: string[] }).items
    d = removeItem(d, ticker.id, 1)
    expect((byTemplate(d, 'ticker').content as { items: string[] }).items).toEqual(
      items.filter((_, i) => i !== 1),
    )
    expect(removeItem(d, ticker.id, 99)).toBe(d)
    expect(removeItem(d, ticker.id, -1)).toBe(d)
  })

  it('seções sem lista não aceitam item', () => {
    const d = doc()
    expect(addItem(d, byTemplate(d, 'hero').id)).toBe(d)
    expect(addItem(d, byTemplate(d, 'carousel').id)).toBe(d)
  })
})

describe('alterações pendentes', () => {
  it('só há alteração quando o conteúdo realmente difere; voltar ao valor original limpa', () => {
    const d = doc()
    const hero = byTemplate(d, 'hero')
    const original = readField(hero, 'heading') as string
    const edited = setField(d, hero.id, 'heading', `${original}!`)
    expect(isDirty(d, d)).toBe(false)
    expect(isDirty(d, edited)).toBe(true)
    expect(isDirty(d, setField(edited, hero.id, 'heading', original))).toBe(false)
  })

  it('ids, ordem e tipos não mudam por nenhuma operação de edição', () => {
    const d = doc()
    const shape = (x: CmsDocumentV2) =>
      x.modules.map((m) => `${m.id}:${m.template}:${m.navigation}`)
    let e = d
    for (const module of d.modules) {
      e = setVisible(e, module.id, false)
      e = addItem(e, module.id)
      e = setField(e, module.id, 'heading', 'x')
    }
    expect(shape(e)).toEqual(shape(d))
    expect(e.commercial).toEqual(d.commercial)
  })
})

it('E6.2: caminhos aninhados de mídia e catálogo permanecem protegidos', () => {
  const d = doc()
  const hero = byTemplate(d, 'hero')
  const carousel = byTemplate(d, 'carousel')
  if (hero.template !== 'hero' || carousel.template !== 'carousel') throw new Error('fixture')
  hero.content.media = { id: 'media_12345678-1234-4123-8123-123456789012', alt: 'Original' }
  carousel.content.entries = [{ itemId: 'dronken', media: { ...hero.content.media } }]
  // o ID de uma mídia nunca muda por campo de texto (trocar a imagem usa setMedia, com outro ID)
  expect(setField(d, hero.id, 'media.id', 'intruso')).toBe(d)
  // o texto alternativo é editorial: edita só o alt, mantendo o ID
  const edited = setField(d, hero.id, 'media.alt', 'Barril de chopp')
  const editedHero = byTemplate(edited, 'hero')
  if (editedHero.template !== 'hero') throw new Error('fixture')
  expect(editedHero.content.media).toEqual({ id: hero.content.media.id, alt: 'Barril de chopp' })
  expect(hero.content.media?.alt).toBe('Original')
  // a vitrine preserva o alt da capa: nenhuma edição de texto chega nela
  expect(setField(d, carousel.id, 'media.alt', 'intruso')).toBe(d)
  for (const key of ['entries.0.itemId', 'entries.0.media.id', 'entries.0.media.alt'])
    expect(setField(d, carousel.id, key, 'intruso')).toBe(d)
})

describe('M2B: imagem da seção e texto alternativo', () => {
  const ID = 'media_12345678-1234-4123-8123-123456789012'
  const OTHER = 'media_22222222-1234-4123-8123-123456789012'

  it('hero, sobre e destaque aceitam imagem; as demais seções, e a vitrine, não', () => {
    const d = doc()
    for (const template of ['hero', 'about'])
      expect(hasMediaSlot(byTemplate(d, template)), template).toBe(true)
    for (const template of ['carousel', 'ticker', 'catalog', 'how', 'faq', 'contact'])
      expect(hasMediaSlot(byTemplate(d, template)), template).toBe(false)
  })

  it('escolher uma imagem grava só {id, alt} e o contrato continua aceitando o rascunho', () => {
    const d = doc()
    const hero = byTemplate(d, 'hero')
    const next = setMedia(d, hero.id, ID)
    expect(readMedia(byTemplate(next, 'hero'))).toEqual({ id: ID, alt: '' })
    expect(accepted(next)).toBe(true)
    expect(Object.keys(readMedia(byTemplate(next, 'hero')) ?? {}).sort()).toEqual(['alt', 'id'])
    // o documento original não é alterado e o resto fica idêntico
    expect(readMedia(hero)).toBeNull()
    expect(next.commercial).toEqual(d.commercial)
    expect(next.modules.map((m) => m.id)).toEqual(d.modules.map((m) => m.id))
    expect(next.modules.slice(1)).toEqual(d.modules.slice(1))
  })

  it('trocar a imagem usa outro ID, mantém o texto alternativo para conferência e não toca nas demais', () => {
    let d = setMedia(doc(), byTemplate(doc(), 'hero').id, ID)
    const heroId = byTemplate(d, 'hero').id
    d = setField(d, heroId, 'media.alt', 'Barril sobre o balcão')
    const swapped = setMedia(d, heroId, OTHER)
    expect(readMedia(byTemplate(swapped, 'hero'))).toEqual({
      id: OTHER,
      alt: 'Barril sobre o balcão',
    })
    // escolher a mesma imagem de novo não altera nada (referência igual, sem sujar o rascunho)
    expect(setMedia(d, heroId, ID)).toBe(d)
    expect(isDirty(d, swapped)).toBe(true)
  })

  it('remover deixa a seção sem imagem; remover de novo não muda nada', () => {
    const d = setMedia(doc(), byTemplate(doc(), 'about').id, ID)
    const aboutId = byTemplate(d, 'about').id
    const cleared = clearMedia(d, aboutId)
    expect(readMedia(byTemplate(cleared, 'about'))).toBeNull()
    expect(accepted(cleared)).toBe(true)
    expect(clearMedia(cleared, aboutId)).toBe(cleared)
  })

  it('seções sem espaço de imagem, e a vitrine, nunca recebem mídia', () => {
    const d = doc()
    for (const template of ['carousel', 'faq', 'contact', 'catalog', 'ticker', 'how']) {
      const id = byTemplate(d, template).id
      expect(setMedia(d, id, ID), template).toBe(d)
      expect(clearMedia(d, id), template).toBe(d)
    }
    expect(setMedia(d, 'inexistente', ID)).toBe(d)
  })

  it('texto alternativo: 200 passa, 201 não; links, < > e quebra de linha são recusados com explicação', () => {
    expect(kindOf('media.alt')).toBe('alt')
    expect(ALT_LIMIT).toBe(200)
    expect(fieldProblem('a'.repeat(200), 'alt')).toBeNull()
    expect(fieldProblem('a'.repeat(201), 'alt')).toMatch(/Sobra 1 caractere: o limite é 200/)
    expect(fieldProblem('veja https://exemplo.com', 'alt')).toMatch(/links/)
    expect(fieldProblem('oi <b>', 'alt')).toMatch(/símbolos/)
    expect(fieldProblem('duas\nlinhas', 'alt')).toMatch(/uma linha só/)
    // vazio é aceito no rascunho (a publicação exigirá texto)
    expect(fieldProblem('', 'alt')).toBeNull()
  })

  it('checkDocument aponta o texto alternativo inválido pela chave do campo e bloqueia o salvamento', () => {
    let d = setMedia(doc(), byTemplate(doc(), 'hero').id, ID)
    const heroId = byTemplate(d, 'hero').id
    d = setField(d, heroId, 'media.alt', 'a'.repeat(201))
    const check = checkDocument(d)
    expect([...check.problems.keys()]).toEqual([problemKey(heroId, 'media.alt')])
    expect(check.sections.has(heroId)).toBe(true)
    expect(canSave(check)).toBe(false)
    d = setField(d, heroId, 'media.alt', 'a'.repeat(200))
    expect(canSave(checkDocument(d))).toBe(true)
    expect(accepted(d)).toBe(true)
  })

  it('o contrato aceita exatamente o que o modelo aceita no alt (200) e recusa 201', () => {
    for (const [length, ok] of [
      [200, true],
      [201, false],
    ] as const) {
      const d = setField(
        setMedia(doc(), byTemplate(doc(), 'hero').id, ID),
        'hero',
        'media.alt',
        'x'.repeat(length),
      )
      expect(accepted(d), String(length)).toBe(ok)
    }
  })

  it('imagem e texto alternativo contam como alteração do rascunho', () => {
    const d = doc()
    const withMedia = setMedia(d, byTemplate(d, 'hero').id, ID)
    expect(isDirty(d, withMedia)).toBe(true)
    expect(isDirty(withMedia, clearMedia(withMedia, byTemplate(withMedia, 'hero').id))).toBe(true)
    expect(isDirty(d, clearMedia(withMedia, byTemplate(withMedia, 'hero').id))).toBe(false)
  })
})
