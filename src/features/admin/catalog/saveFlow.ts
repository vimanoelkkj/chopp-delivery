import { buildSaveInput, type Draft, rebaseDraft, validate } from './draft'
import { AdminApiError, type AdminCatalogGateway } from './gateway'
import type { AdminCatalog, SaveInput, SaveResult } from './types'

/**
 * Orquestração pura (sem React) do salvamento e da recuperação de resultado incerto. Fica
 * separada do hook para ser testada contra qualquer `AdminCatalogGateway` (mock ou HTTP).
 */

export type SaveOutcome =
  | { kind: 'invalid' }
  | { kind: 'saved'; result: SaveResult }
  | { kind: 'conflict' }
  | { kind: 'unauthenticated' }
  | { kind: 'rejected' }
  /** Origem/CSRF recusada (403): nada foi gravado. */
  | { kind: 'forbidden' }
  /** Passaria dos limites do servidor: nem é enviado. */
  | { kind: 'limit'; message: string }
  /** Resposta perdida / 5xx / rede: a escrita pode ter sido confirmada. Guardar `input`. */
  | { kind: 'uncertain'; input: SaveInput }

/** Limites do PUT v2 no servidor (F3A.2): conferidos antes de enviar para não gastar uma viagem. */
export const SAVE_LIMITS = { bytes: 131072, items: 128, perItem: 8, variants: 512 } as const

/** `null` se o pedido cabe nos limites; senão a mensagem para o usuário. Mesma contagem do servidor. */
export function limitViolation(input: SaveInput): string | null {
  const items = input.categories.flatMap((category) => category.items)
  if (items.some((item) => item.variants.length > SAVE_LIMITS.perItem))
    return `Cada produto aceita no máximo ${SAVE_LIMITS.perItem} variantes.`
  if (items.length > SAVE_LIMITS.items)
    return `O catálogo aceita no máximo ${SAVE_LIMITS.items} produtos.`
  if (items.reduce((sum, item) => sum + item.variants.length, 0) > SAVE_LIMITS.variants)
    return `O catálogo aceita no máximo ${SAVE_LIMITS.variants} variantes no total.`
  if (new TextEncoder().encode(JSON.stringify(input)).length > SAVE_LIMITS.bytes)
    return 'O catálogo ficou grande demais para salvar (limite de 128 KiB). Encurte descrições ou remova variantes novas.'
  return null
}

/** Valida, monta o pedido (mesma revisão base e mesmos clientIds a cada tentativa) e envia. */
export async function performSave(
  gateway: AdminCatalogGateway,
  saved: AdminCatalog,
  draft: Draft,
): Promise<SaveOutcome> {
  if (Object.keys(validate(draft)).length) return { kind: 'invalid' }
  const input = buildSaveInput(saved, draft)
  const message = limitViolation(input)
  if (message) return { kind: 'limit', message }
  try {
    return { kind: 'saved', result: await gateway.save(input) }
  } catch (error) {
    if (error instanceof AdminApiError) {
      if (error.code === 'conflict') return { kind: 'conflict' }
      if (error.code === 'unauthenticated') return { kind: 'unauthenticated' }
      if (error.code === 'rejected') return { kind: 'rejected' }
      if (error.code === 'forbidden') return { kind: 'forbidden' }
    }
    return { kind: 'uncertain', input }
  }
}

export type Recovery = 'applied' | 'not-applied' | 'conflict'

/** Todos os clientIds (itens e variantes) que o pedido tentou criar. */
export function creationRefs(input: SaveInput): string[] {
  return input.categories.flatMap((category) =>
    category.items.flatMap((item) => [
      ...('clientId' in item ? [item.clientId] : []),
      ...item.variants.flatMap((variant) => ('clientId' in variant ? [variant.clientId] : [])),
    ]),
  )
}

/**
 * O snapshot do servidor é exatamente o estado que o pedido queria produzir? Compara categorias,
 * ordem, itens (por `id`, ou por `creationRef` quando eram novos), variantes (por `code` ou
 * `creationRef`) e todos os valores canônicos (centavos, ml, texto já aparado). Sem atalhos:
 * presença de creationRef sozinha não prova nada, e um pedido sem criações não é "sucesso por
 * vacuidade". Se o servidor normalizar texto, o resultado é "não equivale" (conflito, lado seguro).
 */
export function satisfies(input: SaveInput, snapshot: AdminCatalog): boolean {
  if (input.categories.length !== snapshot.categories.length) return false
  return input.categories.every((category, index) => {
    const actual = snapshot.categories[index]
    if (
      actual.id !== category.id ||
      actual.name !== category.name ||
      actual.items.length !== category.items.length
    )
      return false
    return category.items.every((item, position) => {
      const real = actual.items[position]
      const sameItem = 'id' in item ? real.id === item.id : real.creationRef === item.clientId
      return (
        sameItem &&
        real.name === item.name &&
        real.description === item.description &&
        real.visible === item.visible &&
        real.variants.length === item.variants.length &&
        item.variants.every((variant, i) => {
          const actualVariant = real.variants[i]
          const sameVariant =
            'code' in variant
              ? actualVariant.code === variant.code
              : actualVariant.creationRef === variant.clientId
          return (
            sameVariant &&
            actualVariant.label === variant.label &&
            actualVariant.volumeMl === variant.volumeMl &&
            actualVariant.priceCents === variant.priceCents
          )
        })
      )
    })
  })
}

/**
 * Decide, com o snapshot atual do servidor, o que aconteceu com um PUT de resultado incerto.
 * - snapshot equivale ao estado pretendido ⇒ applied (inclui PUT idêntico que não mudou a revisão).
 * - senão, revisão igual à base ⇒ not-applied: nada foi gravado; reenviar o MESMO pedido é seguro.
 * - senão ⇒ conflict: a revisão avançou sem equivaler ao pretendido (outra sessão, ou gravou e
 *   alguém mexeu antes do GET). Nunca declara sucesso nem manda a revisão nova por conta própria.
 */
export function classifyUncertain(input: SaveInput, snapshot: AdminCatalog): Recovery {
  if (satisfies(input, snapshot)) return 'applied'
  return snapshot.revision === input.revision ? 'not-applied' : 'conflict'
}

export type RecoveryOutcome =
  | { kind: 'unreachable' }
  | { kind: 'unauthenticated' }
  | { kind: Recovery; snapshot: AdminCatalog }

/** Leitura somente (GET) para reconciliar um PUT incerto; nunca reenvia nada. */
export async function recoverUncertain(
  gateway: AdminCatalogGateway,
  input: SaveInput,
  signal?: AbortSignal,
): Promise<RecoveryOutcome> {
  let snapshot: AdminCatalog
  try {
    snapshot = await gateway.load(signal)
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'unauthenticated')
      return { kind: 'unauthenticated' }
    return { kind: 'unreachable' }
  }
  return { kind: classifyUncertain(input, snapshot), snapshot }
}

/**
 * Pedido incerto confirmado como gravado: o rascunho atual ainda é o que foi enviado? Se sim,
 * devolve `null` (basta recarregar do snapshot). Se o usuário editou depois da tentativa,
 * devolve o rascunho dele reapontado para os ids definitivos, sem perder essas edições.
 */
export function rebaseAfterApplied(
  input: SaveInput,
  base: AdminCatalog,
  draft: Draft,
  snapshot: AdminCatalog,
): Draft | null {
  if (JSON.stringify(buildSaveInput(base, draft)) === JSON.stringify(input)) return null
  return rebaseDraft(draft, snapshot)
}

/**
 * Rascunho guardado em memória quando a sessão expira (não sobrevive a recarregar a página).
 * Fica preso à identidade que o criou: outro usuário nunca o recebe.
 */
export type Rescue = { draft: Draft; revision: string; userId: string }

/** Mesma revisão E mesmo usuário ⇒ o rascunho ainda se aplica; qualquer diferença ⇒ descartado (com aviso). */
export const canRestore = (rescue: Rescue, snapshot: AdminCatalog, userId: string) =>
  rescue.revision === snapshot.revision && rescue.userId === userId
