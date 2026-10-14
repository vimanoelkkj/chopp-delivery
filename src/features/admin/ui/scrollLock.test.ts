import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function page({ inner = 1440, client = 1425, ownPadding = 0, inlinePadding = '' } = {}) {
  const html = { clientWidth: client, style: { paddingRight: inlinePadding } }
  const body = { style: { overflow: '' } }
  vi.stubGlobal('document', { documentElement: html, body })
  vi.stubGlobal('window', { innerWidth: inner })
  vi.stubGlobal('getComputedStyle', () => ({ paddingRight: `${ownPadding}px` }))
  return { html, body }
}

describe('lockScroll', () => {
  let lockScroll: typeof import('./scrollLock').lockScroll

  beforeEach(async () => {
    vi.resetModules() // o contador de travas é estado do módulo
    ;({ lockScroll } = await import('./scrollLock'))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('trava no body e compensa a barra de rolagem medida (15 px)', () => {
    const { html, body } = page()
    const unlock = lockScroll()
    expect(body.style.overflow).toBe('hidden')
    expect(html.style.paddingRight).toBe('15px')
    unlock()
    expect(body.style.overflow).toBe('')
    expect(html.style.paddingRight).toBe('')
  })

  it('sem barra clássica (celular, barra sobreposta) não adiciona padding', () => {
    const { html, body } = page({ client: 390, inner: 390 })
    const unlock = lockScroll()
    expect(body.style.overflow).toBe('hidden')
    expect(html.style.paddingRight).toBe('')
    unlock()
  })

  it('soma ao padding próprio do html sem duplicar e restaura o valor inline anterior', () => {
    const { html } = page({ ownPadding: 8, inlinePadding: '8px' })
    const unlock = lockScroll()
    expect(html.style.paddingRight).toBe('23px')
    unlock()
    expect(html.style.paddingRight).toBe('8px')
  })

  it('modais sobrepostos: só o último a fechar destrava; soltar duas vezes não destrava antes', () => {
    const { html, body } = page()
    const first = lockScroll()
    const second = lockScroll()
    expect(html.style.paddingRight).toBe('15px') // medido uma vez, não 30
    first()
    first()
    expect(body.style.overflow).toBe('hidden')
    second()
    expect(body.style.overflow).toBe('')
    expect(html.style.paddingRight).toBe('')
  })

  it('travar de novo depois de destravar mede a barra outra vez', () => {
    const { html } = page()
    lockScroll()()
    html.clientWidth = 1420
    const unlock = lockScroll()
    expect(html.style.paddingRight).toBe('20px')
    unlock()
  })
})
