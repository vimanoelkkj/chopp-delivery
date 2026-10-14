import { describe, expect, it } from 'vitest'
import { buildCatalog, draftFrom } from './draft'
import { AdminApiError } from './gateway'
import { createMockGateway, readMockMode } from './mockGateway'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error) => (error instanceof AdminApiError ? error.code : 'other'),
  )

describe('mock gateway: mesmo contrato que a F3A precisa cumprir', () => {
  it('load devolve cópia: editar o resultado não altera o armazenado', async () => {
    const gateway = createMockGateway(undefined, 0)
    const first = await gateway.load()
    first.chopes[0].prices['30'] = 1
    expect((await gateway.load()).chopes[0].prices['30']).toBe(51000)
  })

  it('save avança a revisão e a nova base é aceita', async () => {
    const gateway = createMockGateway(undefined, 0)
    const loaded = await gateway.load()
    const draft = draftFrom(loaded)
    draft.text.dronken['30'] = '515,00'
    const saved = await gateway.save(buildCatalog(loaded, draft))
    expect(saved.revision).not.toBe(loaded.revision)
    expect(saved.chopes[0].prices['30']).toBe(51500)
    draft.text.dronken['30'] = '520,00'
    expect((await gateway.save(buildCatalog(saved, draft))).chopes[0].prices['30']).toBe(52000)
  })

  it('save com base desatualizada falha com conflict e não grava nada', async () => {
    const gateway = createMockGateway(undefined, 0)
    const stale = await gateway.load()
    const draft = draftFrom(stale)
    draft.text.dronken['30'] = '515,00'
    await gateway.save(buildCatalog(stale, draft)) // outra sessão salva primeiro
    draft.text.dronken['30'] = '999,00'
    draft.text.kaiser['50'] = '1,00'
    expect(await code(gateway.save(buildCatalog(stale, draft)))).toBe('conflict')
    const current = await gateway.load()
    expect(current.chopes[0].prices['30']).toBe(51500)
    expect(current.chopes[5].prices['50']).toBe(89000)
  })

  it('modo conflict simula outra sessão uma única vez; recarregar resolve', async () => {
    const gateway = createMockGateway('conflict', 0)
    const loaded = await gateway.load()
    const draft = draftFrom(loaded)
    draft.text['palato-beber']['50'] = '650,00'
    expect(await code(gateway.save(buildCatalog(loaded, draft)))).toBe('conflict')
    const reloaded = await gateway.load()
    expect(reloaded.chopes[0].prices['30']).toBe(53000)
    expect(reloaded.chopes[1].prices['50']).toBe(64000)
    const next = draftFrom(reloaded)
    next.text['palato-beber']['50'] = '650,00'
    expect((await gateway.save(buildCatalog(reloaded, next))).chopes[1].prices['50']).toBe(65000)
  })

  it('outros modos: erro, sessão expirada e vazio', async () => {
    expect(
      await code(
        createMockGateway('save-error', 0).save(await createMockGateway(undefined, 0).load()),
      ),
    ).toBe('unavailable')
    expect(
      await code(
        createMockGateway('expired', 0).save(await createMockGateway(undefined, 0).load()),
      ),
    ).toBe('unauthenticated')
    const gateway = createMockGateway('error', 0)
    expect(await code(gateway.load())).toBe('unavailable')
    expect(await code(gateway.load())).toBe('ok')
    expect((await createMockGateway('empty', 0).load()).chopes).toEqual([])
  })

  it('readMockMode só aceita cenários conhecidos', () => {
    expect(readMockMode('?mock=conflict')).toBe('conflict')
    expect(readMockMode('?mock=nada')).toBeUndefined()
    expect(readMockMode('')).toBeUndefined()
  })
})
