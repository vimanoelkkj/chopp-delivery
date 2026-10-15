import { describe, expect, it } from 'vitest'
import {
  buildSaveInput,
  type Draft,
  draftFrom,
  moveId,
  newItemDraft,
  newVariantDraft,
} from './draft'
import { AdminApiError, type AdminCatalogGateway } from './gateway'
import { createHttpGateway } from './httpGateway'
import { createMockGateway } from './mockGateway'
import { maskPriceInput } from './price'
import {
  canRestore,
  classifyUncertain,
  creationRefs,
  performSave,
  rebaseAfterApplied,
  recoverUncertain,
  satisfies,
} from './saveFlow'
import type { AdminCatalog, CategoryId } from './types'

const items = (catalog: AdminCatalog, category: CategoryId) =>
  catalog.categories.find((c) => c.id === category)?.items ?? []

/** Digitação na máscara: cada tecla acrescenta o caractere ao texto exibido. */
const typePrice = (keys: string) => [...keys].reduce((t, k) => maskPriceInput(t + k, t), '')

function addItem(draft: Draft, category: CategoryId, name: string, volume: string, keys: string) {
  const item = newItemDraft(category)
  item.name = name
  item.variants[0] = {
    ...item.variants[0],
    label: `Variante de ${name}`,
    volumeText: volume,
    priceText: typePrice(keys),
  }
  draft.order[category].push(item.key)
  draft.items[item.key] = item
  return item
}

const setup = async (mode?: Parameters<typeof createMockGateway>[0]) => {
  const gateway = createMockGateway(mode, 0)
  const saved = await gateway.load()
  return { gateway, saved, draft: draftFrom(saved) }
}

/** Gateway que falha de um jeito escolhido, sem alterar o mock por baixo. */
const wrap = (
  inner: AdminCatalogGateway,
  hooks: {
    save?: (input: Parameters<AdminCatalogGateway['save']>[0]) => Promise<void>
    load?: () => void
  },
): AdminCatalogGateway => ({
  load: async (signal) => {
    hooks.load?.()
    return inner.load(signal)
  },
  save: async (input) => {
    await hooks.save?.(input)
    return inner.save(input)
  },
})

describe('1-2. vários produtos e várias cachaças com variantes num rascunho', () => {
  it('salva 3 chopes novos de uma vez; ids definitivos e snapshot completo', async () => {
    const { gateway, saved, draft } = await setup()
    const created = ['Lagunitas', 'Colorado', 'Eisenbahn'].map((n) =>
      addItem(draft, 'chopes', n, '20', '42000'),
    )
    const outcome = await performSave(gateway, saved, draft)
    expect(outcome.kind).toBe('saved')
    if (outcome.kind !== 'saved') return
    expect(items(outcome.result.catalog, 'chopes')).toHaveLength(11)
    expect(outcome.result.created.items.map((e) => e.clientId)).toEqual(created.map((i) => i.key))
    expect(new Set(outcome.result.created.items.map((e) => e.id)).size).toBe(3)
    expect(outcome.result.created.items.every((e) => e.id.startsWith('item_'))).toBe(true)
  })

  it('várias cachaças, uma com 2 variantes em ml exatos', async () => {
    const { gateway, saved, draft } = await setup()
    addItem(draft, 'cachacas', 'Cachaça Ouro', '750', '8990')
    const second = addItem(draft, 'cachacas', 'Cachaça Prata', '1000', '5990')
    second.variants.push({
      ...newVariantDraft(),
      label: 'Garrafa 700 ml',
      volumeText: '700',
      priceText: typePrice('4990'),
    })
    const outcome = await performSave(gateway, saved, draft)
    if (outcome.kind !== 'saved') throw new Error(outcome.kind)
    const cachacas = items(outcome.result.catalog, 'cachacas')
    expect(cachacas).toHaveLength(3)
    expect(cachacas[1].variants.map((v) => [v.volumeMl, v.priceCents])).toEqual([[750, 8990]])
    expect(cachacas[2].variants.map((v) => [v.volumeMl, v.priceCents])).toEqual([
      [1000, 5990],
      [700, 4990],
    ])
    expect(outcome.result.created.variants).toHaveLength(3)
  })
})

describe('3-5. criar + reordenar, descartar temporário, reconciliar clientIds', () => {
  it('a ordem do rascunho (novos e existentes) é a ordem salva, e as chaves de rascunho sobrevivem', async () => {
    const { gateway, saved, draft } = await setup()
    const a = addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    const b = addItem(draft, 'chopes', 'Colorado', '30', '51000')
    draft.order.chopes = moveId(draft.order.chopes, b.key, -1)
    draft.order.chopes = moveId(draft.order.chopes, b.key, -1)
    draft.order.chopes = moveId(draft.order.chopes, 'dronken', 1)
    const expected = [...draft.order.chopes]
    const outcome = await performSave(gateway, saved, draft)
    if (outcome.kind !== 'saved') throw new Error(outcome.kind)
    const next = draftFrom(outcome.result.catalog)
    expect(next.order.chopes).toEqual(expected) // chaves = clientId (novos) ou id (existentes)
    expect(
      items(outcome.result.catalog, 'chopes')
        .map((i) => i.name)
        .slice(-3),
    ).toEqual(['Colorado', 'Chopp de vinho', 'Lagunitas'])
    // clientId → id definitivo, sem perder a linha
    const map = new Map(outcome.result.created.items.map((e) => [e.clientId, e.id]))
    expect(next.items[a.key].id).toBe(map.get(a.key))
    expect(next.items[b.key].id).toBe(map.get(b.key))
    expect(next.items[a.key].key).toBe(a.key)
  })

  it('descartar um produto temporário antes de salvar: não é enviado nem criado', async () => {
    const { gateway, saved, draft } = await setup()
    const keep = addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    const drop = addItem(draft, 'chopes', 'Descartado', '20', '42000')
    draft.order.chopes = draft.order.chopes.filter((k) => k !== drop.key)
    delete draft.items[drop.key]
    const input = buildSaveInput(saved, draft)
    expect(creationRefs(input)).toEqual([keep.key, keep.variants[0].key])
    const outcome = await performSave(gateway, saved, draft)
    if (outcome.kind !== 'saved') throw new Error(outcome.kind)
    expect(items(outcome.result.catalog, 'chopes').map((i) => i.name)).not.toContain('Descartado')
    expect(outcome.result.created.items).toHaveLength(1)
  })

  it('após salvar, o rascunho reconstruído não tem alterações pendentes nem itens temporários', async () => {
    const { gateway, saved, draft } = await setup()
    addItem(draft, 'chopes', 'Lagunitas', '7,5', '30000')
    const outcome = await performSave(gateway, saved, draft)
    if (outcome.kind !== 'saved') throw new Error(outcome.kind)
    const next = draftFrom(outcome.result.catalog)
    expect(Object.values(next.items).every((i) => i.id !== null)).toBe(true)
  })
})

describe('6-7. resposta perdida e recuperação por creationRef, sem duplicar', () => {
  it('gravou mas a resposta se perdeu: incerto → GET reconhece os creationRefs → applied', async () => {
    const { gateway, saved, draft } = await setup('lost-response')
    addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    addItem(draft, 'cachacas', 'Cachaça Ouro', '750', '8990')
    const outcome = await performSave(gateway, saved, draft)
    expect(outcome.kind).toBe('uncertain')
    if (outcome.kind !== 'uncertain') return
    const recovery = await recoverUncertain(gateway, outcome.input)
    expect(recovery.kind).toBe('applied')
    if (recovery.kind !== 'applied') return
    expect(items(recovery.snapshot, 'chopes')).toHaveLength(9)
    expect(items(recovery.snapshot, 'cachacas')).toHaveLength(2)
    // nenhuma duplicação: reenviar o pedido antigo é conflito (base mudou), nunca outra criação
    const replay = await performSave(gateway, saved, draft)
    expect(replay.kind).toBe('conflict')
    expect(items(await gateway.load(), 'chopes')).toHaveLength(9)
  })

  it('nada foi gravado: incerto → not-applied → reenvio do MESMO pedido cria uma única vez', async () => {
    const { gateway: inner, saved, draft } = await setup()
    let failed = false
    const gateway = wrap(inner, {
      save: async () => {
        if (failed) return
        failed = true
        throw new AdminApiError('unavailable') // cai antes de gravar
      },
    })
    addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    const first = await performSave(gateway, saved, draft)
    if (first.kind !== 'uncertain') throw new Error(first.kind)
    const recovery = await recoverUncertain(gateway, first.input)
    expect(recovery.kind).toBe('not-applied')
    const retry = await performSave(gateway, saved, draft) // mesmos clientIds e mesma revisão base
    expect(retry.kind).toBe('saved')
    expect(JSON.stringify(buildSaveInput(saved, draft))).toBe(JSON.stringify(first.input))
    expect(items(await inner.load(), 'chopes')).toHaveLength(9)
  })

  it('sem resposta do GET de verificação: unreachable (continua incerto, nada é reenviado)', async () => {
    const { gateway: inner, saved, draft } = await setup('lost-response')
    addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    const first = await performSave(inner, saved, draft)
    if (first.kind !== 'uncertain') throw new Error(first.kind)
    const down = wrap(inner, {
      load: () => {
        throw new AdminApiError('unavailable')
      },
    })
    expect((await recoverUncertain(down, first.input)).kind).toBe('unreachable')
    expect(items(await inner.load(), 'chopes')).toHaveLength(9) // gravado uma vez, sem reenvio
  })
})

describe('8-9. conflito 409 e sessão expirada', () => {
  it('base desatualizada: conflict, nada gravado, rascunho intacto', async () => {
    const { gateway, saved, draft } = await setup('conflict')
    addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    const before = JSON.stringify(draft)
    expect((await performSave(gateway, saved, draft)).kind).toBe('conflict')
    expect(JSON.stringify(draft)).toBe(before)
    expect(items(await gateway.load(), 'chopes')).toHaveLength(8)
  })

  it('401 no salvamento: unauthenticated; o rascunho vira Rescue restaurável só na mesma revisão', async () => {
    const { gateway, saved, draft } = await setup('expired')
    addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    expect((await performSave(gateway, saved, draft)).kind).toBe('unauthenticated')
    const rescue = { draft, revision: saved.revision, userId: 'owner-id' }
    expect(canRestore(rescue, saved, 'owner-id')).toBe(true)
    expect(canRestore(rescue, { ...saved, revision: '99' }, 'owner-id')).toBe(false)
    expect(canRestore(rescue, saved, 'outro-usuario')).toBe(false) // outra identidade nunca recebe
    expect(rescue.draft.order.chopes).toHaveLength(9) // o item temporário continua no rascunho guardado
  })

  it('401 durante a verificação do resultado incerto também é reportado', async () => {
    const { gateway: inner, saved, draft } = await setup('lost-response')
    addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    const first = await performSave(inner, saved, draft)
    if (first.kind !== 'uncertain') throw new Error(first.kind)
    const expired = wrap(inner, {
      load: () => {
        throw new AdminApiError('unauthenticated')
      },
    })
    expect((await recoverUncertain(expired, first.input)).kind).toBe('unauthenticated')
  })

  it('rejected (400/403/410/428) não é tratado como incerto', async () => {
    const { gateway: inner, saved, draft } = await setup()
    addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    const gateway = wrap(inner, {
      save: async () => {
        throw new AdminApiError('rejected')
      },
    })
    expect((await performSave(gateway, saved, draft)).kind).toBe('rejected')
  })

  it('rascunho inválido nunca chama o servidor', async () => {
    const { saved, draft } = await setup()
    const item = newItemDraft('chopes') // vazio
    draft.order.chopes.push(item.key)
    draft.items[item.key] = item
    let calls = 0
    const gateway = wrap(createMockGateway(undefined, 0), {
      save: async () => {
        calls++
      },
    })
    expect((await performSave(gateway, saved, draft)).kind).toBe('invalid')
    expect(calls).toBe(0)
  })
})

describe('10. máscara monetária e volumeMl exato até o contrato', () => {
  it('preço digitado vira centavos inteiros; litros viram ml exatos; ml ficam como digitados', async () => {
    const { gateway, saved, draft } = await setup()
    addItem(draft, 'chopes', 'Lagunitas', '7,5', '125050')
    addItem(draft, 'chopes', 'Colorado', '0,33', '1')
    addItem(draft, 'cachacas', 'Cachaça Ouro', '750', '9999999')
    const input = buildSaveInput(saved, draft)
    const sent = input.categories.flatMap((c) => c.items).filter((i) => 'clientId' in i)
    expect(sent.map((i) => [i.variants[0].volumeMl, i.variants[0].priceCents])).toEqual([
      [7500, 125050],
      [330, 1],
      [750, 9999999],
    ])
    const outcome = await performSave(gateway, saved, draft)
    if (outcome.kind !== 'saved') throw new Error(outcome.kind)
    const back = [
      ...items(outcome.result.catalog, 'chopes').slice(-2),
      ...items(outcome.result.catalog, 'cachacas').slice(-1),
    ]
    expect(back.map((i) => [i.variants[0].volumeMl, i.variants[0].priceCents])).toEqual([
      [7500, 125050],
      [330, 1],
      [750, 9999999],
    ])
  })
})

/**
 * Casos de borda da recuperação: a decisão compara o snapshot com o ESTADO PRETENDIDO inteiro;
 * presença de creationRef, ou ausência de criações, nunca basta como prova de sucesso.
 */
describe('recuperação: casos de borda', () => {
  /** Perde a resposta do PUT e devolve o pedido incerto + o gateway (já com a gravação feita). */
  const lose = async (edit: (draft: Draft) => void) => {
    const { gateway, saved, draft } = await setup('lost-response')
    edit(draft)
    const out = await performSave(gateway, saved, draft)
    if (out.kind !== 'uncertain') throw new Error(out.kind)
    return { gateway, saved, draft, input: out.input }
  }
  /** Outra sessão salva por cima (revisão avança) antes do GET de recuperação. */
  const otherSession = async (gateway: AdminCatalogGateway, edit: (draft: Draft) => void) => {
    const now = await gateway.load()
    const draft = draftFrom(now)
    edit(draft)
    const out = await performSave(gateway, now, draft)
    if (out.kind !== 'saved') throw new Error(out.kind)
  }

  it('só produtos existentes (sem criações): gravado e equivalente → applied', async () => {
    const { gateway, input } = await lose((d) => {
      d.items.kaiser.visible = false
      d.items.dronken.variants[0].priceText = '999,00'
    })
    expect(creationRefs(input)).toEqual([]) // sem refs: nada de "prova por vacuidade"
    expect((await recoverUncertain(gateway, input)).kind).toBe('applied')
  })

  it('só existentes, outra sessão mexeu em OUTRO produto antes do GET → conflict (não afirma sucesso)', async () => {
    const { gateway, input } = await lose((d) => {
      d.items.kaiser.visible = false
    })
    await otherSession(gateway, (d) => {
      d.items.brahma.variants[1].priceText = '1,00'
    })
    expect((await recoverUncertain(gateway, input)).kind).toBe('conflict')
  })

  it('só existentes, outra sessão sobrescreveu o MESMO campo → conflict', async () => {
    const { gateway, input } = await lose((d) => {
      d.items.dronken.variants[0].priceText = '999,00'
    })
    await otherSession(gateway, (d) => {
      d.items.dronken.variants[0].priceText = '111,00'
    })
    expect((await recoverUncertain(gateway, input)).kind).toBe('conflict')
  })

  it('criar + editar existente: gravado e equivalente → applied, sem duplicar', async () => {
    const { gateway, input } = await lose((d) => {
      addItem(d, 'chopes', 'Lagunitas', '20', '42000')
      d.items.dronken.variants[0].priceText = '999,00'
    })
    expect((await recoverUncertain(gateway, input)).kind).toBe('applied')
    expect(items(await gateway.load(), 'chopes')).toHaveLength(9)
  })

  it('criar + editar: os creationRefs estão lá, mas a edição do existente foi sobrescrita → conflict', async () => {
    const { gateway, input } = await lose((d) => {
      addItem(d, 'chopes', 'Lagunitas', '20', '42000')
      d.items.dronken.variants[0].priceText = '999,00'
    })
    await otherSession(gateway, (d) => {
      d.items.dronken.variants[0].priceText = '111,00'
    })
    const snapshot = JSON.stringify(await gateway.load())
    expect(creationRefs(input).every((ref) => snapshot.includes(ref))).toBe(true) // refs presentes
    expect((await recoverUncertain(gateway, input)).kind).toBe('conflict') // antes: applied
  })

  it('PUT confirmado e outra sessão criou OUTRO produto antes do GET → conflict', async () => {
    const { gateway, input } = await lose((d) => {
      addItem(d, 'chopes', 'Lagunitas', '20', '42000')
    })
    await otherSession(gateway, (d) => {
      addItem(d, 'chopes', 'Colorado', '30', '51000')
    })
    expect((await recoverUncertain(gateway, input)).kind).toBe('conflict')
  })

  it('creationRefs já persistidos antes: um pedido velho só equivale se TODOS os valores batem', async () => {
    const { gateway, saved, draft } = await setup('lost-response')
    const first = addItem(draft, 'chopes', 'Lagunitas', '20', '42000')
    const firstOut = await performSave(gateway, saved, draft)
    if (firstOut.kind !== 'uncertain') throw new Error(firstOut.kind)
    const snapshot = await gateway.load()
    expect(items(snapshot, 'chopes').at(-1)?.creationRef).toBe(first.key)
    // pedido antigo com o mesmo clientId, mas outro nome: o ref existe e mesmo assim não é sucesso
    const stale = structuredClone(firstOut.input)
    const staleItem = stale.categories.find((c) => c.id === 'chopes')?.items.at(-1)
    if (!staleItem) throw new Error('sem item')
    staleItem.name = 'Outro nome'
    stale.revision = 'antiga'
    expect(classifyUncertain(stale, snapshot)).toBe('conflict')
    expect(classifyUncertain(firstOut.input, snapshot)).toBe('applied') // o que de fato foi gravado
    // edição seguinte sobre o item já persistido vai por id: nenhum ref a "provar"
    const next = draftFrom(snapshot)
    next.items[first.key].visible = true
    expect(creationRefs(buildSaveInput(snapshot, next))).toEqual([])
    expect((await performSave(gateway, snapshot, next)).kind).toBe('saved')
  })

  it('revisão mudou mas o snapshot é incompatível com o rascunho enviado → conflict', async () => {
    const { saved, draft } = await setup()
    draft.items.kaiser.visible = false
    const input = buildSaveInput(saved, draft)
    const renamed = structuredClone(saved)
    renamed.revision = '9'
    renamed.categories[0].items[5].name = 'Kaiser renomeado'
    expect(classifyUncertain(input, renamed)).toBe('conflict')
    const missing = structuredClone(saved) // item sumiu do servidor: também não é sucesso
    missing.revision = '9'
    missing.categories[0].items = missing.categories[0].items.filter((i) => i.id !== 'kaiser')
    expect(classifyUncertain(input, missing)).toBe('conflict')
  })

  it('PUT idêntico que não altera a revisão: nunca vira conflito; reenviar é seguro', async () => {
    const { gateway, saved, draft } = await setup('lost-response')
    const out = await performSave(gateway, saved, draft) // rascunho sem mudanças
    if (out.kind !== 'uncertain') throw new Error(out.kind)
    const result = await recoverUncertain(gateway, out.input)
    if ('snapshot' in result) expect(result.snapshot.revision).toBe(saved.revision)
    expect(['applied', 'not-applied']).toContain(result.kind)
    expect((await performSave(gateway, saved, draft)).kind).toBe('saved') // no-op, mesma revisão
  })

  it('revisão igual e valores diferentes → not-applied (nada gravado; reenvio do mesmo pedido)', async () => {
    const { gateway, saved, draft } = await setup()
    draft.items.kaiser.visible = false
    const input = buildSaveInput(saved, draft)
    expect(classifyUncertain(input, await gateway.load())).toBe('not-applied')
  })

  it('GET de recuperação indisponível, 5xx ou com contrato inválido → unreachable; nada é afirmado', async () => {
    const { input } = await lose((d) => {
      d.items.kaiser.visible = false
    })
    const respond = (response: () => Response) =>
      createHttpGateway({ fetch: async () => response() })
    const down = createHttpGateway({
      fetch: async () => {
        throw new TypeError('network')
      },
    })
    const body = JSON.stringify({ revision: 'r9', categories: 'x' })
    const gateways = [
      respond(() => new Response('{}', { status: 503 })),
      respond(() => new Response('<html>', { status: 200 })),
      respond(() => new Response(body, { status: 200 })),
      down,
    ]
    for (const gateway of gateways)
      expect((await recoverUncertain(gateway, input)).kind).toBe('unreachable')
  })

  it('satisfies compara ordem, categorias e valores canônicos', async () => {
    const { saved, draft } = await setup()
    draft.order.chopes = moveId(draft.order.chopes, 'kaiser', -1)
    const input = buildSaveInput(saved, draft)
    expect(satisfies(input, saved)).toBe(false) // ordem diferente
    const moved = structuredClone(saved)
    const [kaiser] = moved.categories[0].items.splice(5, 1)
    moved.categories[0].items.splice(4, 0, kaiser)
    expect(satisfies(input, moved)).toBe(true)
  })

  it('edição feita DEPOIS da tentativa incerta é preservada quando o salvamento anterior se confirma', async () => {
    const { gateway, saved, draft, input } = await lose((d) => {
      addItem(d, 'chopes', 'Lagunitas', '20', '42000')
    })
    const created = Object.values(draft.items).find((i) => i.name === 'Lagunitas')
    if (!created) throw new Error('sem item')
    draft.items.kaiser.visible = false // o usuário seguiu editando (o GET estava fora do ar)
    created.name = 'Lagunitas IPA'
    const recovery = await recoverUncertain(gateway, input)
    if (recovery.kind !== 'applied') throw new Error(recovery.kind)
    const rebased = rebaseAfterApplied(input, saved, draft, recovery.snapshot)
    if (!rebased) throw new Error('devia reapontar o rascunho')
    expect(rebased.items.kaiser.visible).toBe(false)
    expect(rebased.items[created.key].name).toBe('Lagunitas IPA')
    expect(rebased.items[created.key].id).toMatch(/^item_/) // não será recriado
    expect(rebased.items[created.key].variants[0].code).toMatch(/^v_/)
    const next = await performSave(gateway, recovery.snapshot, rebased)
    expect(next.kind).toBe('saved')
    if (next.kind !== 'saved') return
    expect(items(next.result.catalog, 'chopes')).toHaveLength(9)
    expect(items(next.result.catalog, 'chopes').at(-1)?.name).toBe('Lagunitas IPA')
  })

  it('sem edições posteriores, rebaseAfterApplied devolve null (recarrega do snapshot)', async () => {
    const { gateway, saved, draft, input } = await lose((d) => {
      addItem(d, 'chopes', 'Lagunitas', '20', '42000')
    })
    const recovery = await recoverUncertain(gateway, input)
    if (recovery.kind !== 'applied') throw new Error(recovery.kind)
    expect(rebaseAfterApplied(input, saved, draft, recovery.snapshot)).toBeNull()
  })
})
