import { formatPriceText, parsePriceText } from './price'
import {
  type AdminCatalog,
  type AdminItem,
  type PriceSlot,
  SLOTS,
  TAB_IDS,
  type TabId,
} from './types'

/** Rascunho: o que está na tela. Preços ficam como texto digitado até o envio. */
export type Draft = {
  order: Record<TabId, string[]>
  visible: Record<string, boolean>
  text: Record<string, Partial<Record<PriceSlot, string>>>
}

export type FieldErrors = Record<string, Partial<Record<PriceSlot | 'row', string>>>

export function draftFrom(catalog: AdminCatalog): Draft {
  const draft: Draft = { order: { chopes: [], cachacas: [] }, visible: {}, text: {} }
  for (const tab of TAB_IDS)
    for (const item of catalog[tab]) {
      draft.order[tab].push(item.id)
      draft.visible[item.id] = item.visible
      draft.text[item.id] = Object.fromEntries(
        SLOTS[tab].map(({ slot }) => [slot, formatPriceText(item.prices[slot])]),
      )
    }
  return draft
}

export function findItem(catalog: AdminCatalog, id: string): AdminItem | undefined {
  return [...catalog.chopes, ...catalog.cachacas].find((item) => item.id === id)
}

export function validate(draft: Draft): FieldErrors {
  const errors: FieldErrors = {}
  for (const tab of TAB_IDS)
    for (const id of draft.order[tab]) {
      const found: FieldErrors[string] = {}
      let priced = 0
      for (const { slot, required } of SLOTS[tab]) {
        const result = parsePriceText(draft.text[id]?.[slot] ?? '')
        if (!result.ok) found[slot] = result.message
        else if (result.cents === null && required) found[slot] = 'Informe o preço.'
        else if (result.cents !== null) priced++
      }
      if (tab === 'chopes' && draft.visible[id] && priced === 0 && Object.keys(found).length === 0)
        found.row = 'Informe ao menos um preço ou oculte o produto.'
      if (Object.keys(found).length) errors[id] = found
    }
  return errors
}

/** Itens com preço, visibilidade ou posição diferentes do que está salvo. */
export function changedIds(saved: AdminCatalog, draft: Draft): string[] {
  const changed: string[] = []
  for (const tab of TAB_IDS) {
    const savedIds = saved[tab].map((item) => item.id)
    draft.order[tab].forEach((id, index) => {
      const item = findItem(saved, id)
      if (!item) return
      const same =
        savedIds[index] === id &&
        draft.visible[id] === item.visible &&
        SLOTS[tab].every(
          ({ slot }) => draft.text[id]?.[slot]?.trim() === formatPriceText(item.prices[slot]),
        )
      if (!same) changed.push(id)
    })
  }
  return changed
}

/** Monta o catálogo a salvar. Só chamar com `validate(draft)` vazio. */
export function buildCatalog(saved: AdminCatalog, draft: Draft): AdminCatalog {
  const next: AdminCatalog = { revision: saved.revision, chopes: [], cachacas: [] }
  for (const tab of TAB_IDS)
    for (const id of draft.order[tab]) {
      const item = findItem(saved, id)
      if (!item) continue
      const prices: AdminItem['prices'] = {}
      for (const { slot } of SLOTS[tab]) {
        const result = parsePriceText(draft.text[id]?.[slot] ?? '')
        prices[slot] = result.ok ? result.cents : null
      }
      next[tab].push({ ...item, visible: draft.visible[id], prices })
    }
  return next
}

export function moveId(order: string[], id: string, direction: -1 | 1): string[] {
  const from = order.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= order.length) return order
  const next = [...order]
  next[from] = order[to]
  next[to] = id
  return next
}
