import { describe, expect, it } from 'vitest'
import { applyDocumentTheme, PASTEL_THEME } from './documentTheme'

const makeRoot = () => ({ dataset: {} as Record<string, string | undefined> })

describe('applyDocumentTheme', () => {
  it('ativa o tema e o remove ao desfazer', () => {
    const root = makeRoot()
    const release = applyDocumentTheme(root, PASTEL_THEME)
    expect(root.dataset.theme).toBe('pastel')
    release()
    expect(root.dataset.theme).toBeUndefined()
    expect('theme' in root.dataset).toBe(false)
  })

  it('não mexe em outras raízes (o painel não recebe o tema)', () => {
    const vitrine = makeRoot()
    const painel = makeRoot()
    applyDocumentTheme(vitrine, PASTEL_THEME)
    expect(painel.dataset.theme).toBeUndefined()
  })

  it('troca de tela: a nova monta antes de a antiga desmontar e o tema permanece', () => {
    const root = makeRoot()
    const antiga = applyDocumentTheme(root, PASTEL_THEME)
    const nova = applyDocumentTheme(root, PASTEL_THEME)
    antiga()
    expect(root.dataset.theme).toBe('pastel')
    nova()
    expect(root.dataset.theme).toBeUndefined()
  })

  it('StrictMode: ativar, desfazer e ativar de novo deixa o tema ligado uma vez', () => {
    const root = makeRoot()
    applyDocumentTheme(root, PASTEL_THEME)()
    const release = applyDocumentTheme(root, PASTEL_THEME)
    expect(root.dataset.theme).toBe('pastel')
    release()
    expect(root.dataset.theme).toBeUndefined()
  })

  it('desfazer duas vezes é inofensivo e não remove o tema de outra tela ativa', () => {
    const root = makeRoot()
    const a = applyDocumentTheme(root, PASTEL_THEME)
    const b = applyDocumentTheme(root, PASTEL_THEME)
    a()
    a()
    expect(root.dataset.theme).toBe('pastel')
    b()
    expect(root.dataset.theme).toBeUndefined()
  })

  it('com dois temas, volta ao que continua ativo', () => {
    const root = makeRoot()
    const base = applyDocumentTheme(root, 'pastel')
    const outro = applyDocumentTheme(root, 'outro')
    expect(root.dataset.theme).toBe('outro')
    outro()
    expect(root.dataset.theme).toBe('pastel')
    base()
    expect(root.dataset.theme).toBeUndefined()
  })
})
