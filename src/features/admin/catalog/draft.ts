import { formatPriceText, parsePriceText } from './price'
import {
  type AdminCatalog,
  type AdminItem,
  type CategoryId,
  DESCRIPTION_MAX,
  type ItemInput,
  LABEL_MAX,
  NAME_MAX,
  PRICE_REQUIRED,
  type SaveInput,
  STANDARD_COLUMNS,
  type VariantInput,
} from './types'
import { parseVolume, volumeUnit } from './volume'

/**
 * Variante em edição. `key` é a identidade de rascunho: o `code` quando persistida ou o
 * clientId temporário quando nova (`code` null). Preços ficam como texto mascarado.
 */
export type DraftVariant = {
  key: string
  code: string | null
  label: string
  volumeText: string
  priceText: string
}

/** Item em edição. `key` = `creationRef` ou `id` (estável), ou o clientId se ainda não salvo. */
export type DraftItem = {
  key: string
  /** Id definitivo; null enquanto o item só existe no rascunho. */
  id: string | null
  categoryId: CategoryId
  name: string
  description: string
  visible: boolean
  variants: DraftVariant[]
}

export type Draft = {
  order: Record<CategoryId, string[]>
  items: Record<string, DraftItem>
}

/** Mensagens por campo: `name`, `description`, `variants`, `row`, `price:<k>`, `label:<k>`, `volume:<k>`. */
export type FieldErrors = Record<string, Record<string, string>>

export const newClientId = () => `tmp:${crypto.randomUUID()}`

export const isNewItem = (item: DraftItem) => item.id === null

export function newVariantDraft(): DraftVariant {
  return { key: newClientId(), code: null, label: '', volumeText: '', priceText: '' }
}

export function newItemDraft(categoryId: CategoryId): DraftItem {
  return {
    key: newClientId(),
    id: null,
    categoryId,
    name: '',
    description: '',
    visible: false, // cadastro começa oculto: só vai ao site quando o dono ligar
    variants: [newVariantDraft()],
  }
}

function itemDraft(item: AdminItem, categoryId: CategoryId): DraftItem {
  return {
    key: item.creationRef ?? item.id,
    id: item.id,
    categoryId,
    name: item.name,
    description: item.description,
    visible: item.visible,
    variants: item.variants.map((variant) => ({
      key: variant.creationRef ?? variant.code,
      code: variant.code,
      label: variant.label,
      volumeText: variant.volumeMl === null ? '' : String(variant.volumeMl),
      priceText: formatPriceText(variant.priceCents),
    })),
  }
}

export function draftFrom(catalog: AdminCatalog): Draft {
  const draft: Draft = { order: {}, items: {} }
  for (const category of catalog.categories) {
    draft.order[category.id] = []
    for (const item of category.items) {
      const next = itemDraft(item, category.id)
      draft.order[category.id].push(next.key)
      draft.items[next.key] = next
    }
  }
  return draft
}

/** Item persistido cujas variantes são exatamente as colunas padrão da categoria: vai na tabela. */
export function isStandardRow(item: DraftItem): boolean {
  const columns = STANDARD_COLUMNS[item.categoryId]
  return (
    !isNewItem(item) &&
    !!columns &&
    columns.length === item.variants.length &&
    columns.every((column, index) => item.variants[index].code === column.code)
  )
}

export function validate(draft: Draft): FieldErrors {
  const errors: FieldErrors = {}
  for (const [categoryId, keys] of Object.entries(draft.order))
    for (const key of keys) {
      const item = draft.items[key]
      const found: Record<string, string> = {}
      const name = item.name.trim()
      if (!name) found.name = 'Informe o nome.'
      else if ([...name].length > NAME_MAX) found.name = `Use até ${NAME_MAX} caracteres.`
      if ([...item.description].length > DESCRIPTION_MAX)
        found.description = `Use até ${DESCRIPTION_MAX} caracteres.`
      if (item.variants.length === 0) found.variants = 'Inclua ao menos uma variante.'
      let priced = 0
      let priceProblem = false
      for (const variant of item.variants) {
        if (variant.code === null) {
          const label = variant.label.trim()
          if (!label) found[`label:${variant.key}`] = 'Informe o rótulo.'
          else if ([...label].length > LABEL_MAX)
            found[`label:${variant.key}`] = `Use até ${LABEL_MAX} caracteres.`
          const volume = parseVolume(variant.volumeText, volumeUnit(categoryId))
          if (!volume.ok) found[`volume:${variant.key}`] = volume.message
        }
        const price = parsePriceText(variant.priceText)
        if (!price.ok) {
          found[`price:${variant.key}`] = price.message
          priceProblem = true
        } else if (price.cents === null && PRICE_REQUIRED.has(categoryId)) {
          found[`price:${variant.key}`] = 'Informe o preço.'
          priceProblem = true
        } else if (price.cents !== null) priced++
      }
      if (item.visible && priced === 0 && !priceProblem && item.variants.length > 0)
        found.row = 'Informe ao menos um preço ou oculte o produto.'
      if (Object.keys(found).length) errors[key] = found
    }
  return errors
}

/** Chaves dos itens novos, ou persistidos com preço, visibilidade, texto, variantes ou posição alterados. */
export function changedKeys(saved: AdminCatalog, draft: Draft): string[] {
  const changed: string[] = []
  for (const category of saved.categories) {
    const byId = new Map(category.items.map((item, index) => [item.id, { item, index }]))
    draft.order[category.id]?.forEach((key, index) => {
      const item = draft.items[key]
      if (isNewItem(item)) {
        changed.push(key)
        return
      }
      const before = byId.get(item.id as string)
      if (!before) return
      const { item: original } = before
      const same =
        before.index === index &&
        item.visible === original.visible &&
        item.name === original.name &&
        item.description === original.description &&
        item.variants.length === original.variants.length &&
        item.variants.every(
          (variant, i) =>
            variant.priceText.trim() === formatPriceText(original.variants[i].priceCents),
        )
      if (!same) changed.push(key)
    })
  }
  return changed
}

function variantInput(variant: DraftVariant, categoryId: string): VariantInput {
  const price = parsePriceText(variant.priceText)
  // Variante nova: o texto está na unidade da categoria (L nos chopes) e vira ml exatos.
  // Persistida: o texto já é o volume em ml vindo do servidor (somente leitura).
  const parsed =
    variant.code === null ? parseVolume(variant.volumeText, volumeUnit(categoryId)) : null
  const fields = {
    label: variant.label.trim(),
    volumeMl: parsed
      ? parsed.ok
        ? parsed.ml
        : null
      : variant.volumeText
        ? Number(variant.volumeText)
        : null,
    priceCents: price.ok ? price.cents : null,
  }
  return variant.code === null
    ? { clientId: variant.key, ...fields }
    : { code: variant.code, ...fields }
}

function itemInput(item: DraftItem): ItemInput {
  const fields = {
    name: item.name.trim(),
    description: item.description,
    visible: item.visible,
    variants: item.variants.map((variant) => variantInput(variant, item.categoryId)),
  }
  return item.id === null ? { clientId: item.key, ...fields } : { id: item.id, ...fields }
}

/** Monta o pedido de salvamento completo. Só chamar com `validate(draft)` vazio. */
export function buildSaveInput(saved: AdminCatalog, draft: Draft): SaveInput {
  return {
    revision: saved.revision,
    categories: saved.categories.map((category) => ({
      id: category.id,
      items: (draft.order[category.id] ?? []).map((key) => itemInput(draft.items[key])),
    })),
  }
}

/**
 * Aponta os itens/variantes ainda "novos" do rascunho para os ids definitivos que o servidor já
 * gravou (casando por creationRef = clientId). Edições e ordem do rascunho ficam como estão.
 */
export function rebaseDraft(draft: Draft, snapshot: AdminCatalog): Draft {
  const byRef = new Map<string, AdminItem>()
  for (const category of snapshot.categories)
    for (const item of category.items) if (item.creationRef) byRef.set(item.creationRef, item)
  const items: Draft['items'] = {}
  for (const [key, item] of Object.entries(draft.items)) {
    const match = item.id === null ? byRef.get(key) : undefined
    items[key] = match
      ? {
          ...item,
          id: match.id,
          variants: item.variants.map((variant) => {
            const found =
              variant.code === null
                ? match.variants.find((v) => v.creationRef === variant.key)
                : undefined
            return found ? { ...variant, code: found.code } : variant
          }),
        }
      : item
  }
  return { ...draft, items }
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

/** Algo digitado em item novo? Decide se cancelar pede confirmação. */
export function hasContent(item: DraftItem): boolean {
  return (
    !!item.name.trim() ||
    !!item.description.trim() ||
    item.variants.some((v) => v.label.trim() || v.volumeText.trim() || v.priceText.trim())
  )
}
