import { containsControls, unsafeUnicode, validCents, validText } from '../admin-catalog/validation'

export const EXPANSION_LIMITS = { bytes: 131072, items: 128, perItem: 8, variants: 512 }
export type CommandItem = {
  id: string
  isNew: boolean
  creationRef: string | null
  categoryId: string
  name: string
  description: string
  visible: boolean
  position: number
}
export type CommandVariant = {
  itemId: string
  code: string
  isNew: boolean
  creationRef: string | null
  label: string
  volumeMl: number | null
  priceCents: number | null
  position: number
}
export type CatalogCommand = {
  categories: { id: string; name: string; position: number }[]
  items: CommandItem[]
  variants: CommandVariant[]
}
export function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}
export const validId = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 128 &&
  !containsControls(v) &&
  !unsafeUnicode(v)
const clientRef = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^tmp:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) &&
  v.length === 40
export const validVolume = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0

/** Read and write DTOs deliberately differ: creationRef is read-only. */
export function validateExpanded(
  data: unknown,
  revision: string,
): { value: CatalogCommand; fields?: never } | { fields: Record<string, string>; value?: never } {
  const fields: Record<string, string> = {}
  const fail = (path: string, message = 'Campos inválidos, ausentes ou não permitidos.') => {
    fields[path] = message
  }
  if (
    !exact(data, ['revision', 'categories']) ||
    data.revision !== revision ||
    !Array.isArray(data.categories)
  )
    return {
      fields: { catalog: 'Informe revision igual a If-Match e categories, sem campos adicionais.' },
    }
  const command: CatalogCommand = { categories: [], items: [], variants: [] }
  const categories = new Set<string>(),
    ids = new Set<string>(),
    refs = new Set<string>()
  if (data.categories.length > 128) return { fields: { categories: 'Quantidade inválida.' } }
  for (const [ci, category] of data.categories.entries()) {
    const cp = `categories.${ci}`
    if (
      !exact(category, ['id', 'name', 'items']) ||
      !validId(category.id) ||
      !validText(category.name, true) ||
      !Array.isArray(category.items) ||
      categories.has(category.id)
    ) {
      fail(cp)
      continue
    }
    categories.add(category.id)
    command.categories.push({ id: category.id, name: category.name, position: ci })
    for (const [ii, item] of category.items.entries()) {
      const p = `${cp}.items.${ii}`
      const fresh = typeof item === 'object' && item !== null && 'clientId' in item
      const key = fresh ? 'clientId' : 'id'
      if (!exact(item, [key, 'name', 'description', 'visible', 'variants'])) {
        fail(p)
        continue
      }
      const identity = item[key]
      if (
        fresh ? !clientRef(identity) || refs.has(identity) : !validId(identity) || ids.has(identity)
      ) {
        fail(`${p}.${key}`)
        continue
      }
      if (fresh) refs.add(identity as string)
      else ids.add(identity as string)
      if (
        !validText(item.name, true) ||
        !validText(item.description, false) ||
        typeof item.visible !== 'boolean' ||
        !Array.isArray(item.variants) ||
        item.variants.length < 1 ||
        item.variants.length > EXPANSION_LIMITS.perItem
      ) {
        fail(p)
        continue
      }
      const id = fresh ? `item_${crypto.randomUUID()}` : (identity as string)
      command.items.push({
        id,
        isNew: fresh,
        creationRef: fresh ? (identity as string) : null,
        categoryId: category.id,
        name: item.name,
        description: item.description,
        visible: item.visible,
        position: ii,
      })
      const codes = new Set<string>()
      for (const [vi, variant] of item.variants.entries()) {
        const vp = `${p}.variants.${vi}`
        const isNew = typeof variant === 'object' && variant !== null && 'clientId' in variant
        const vk = isNew ? 'clientId' : 'code'
        if (!exact(variant, [vk, 'label', 'volumeMl', 'priceCents'])) {
          fail(vp)
          continue
        }
        const identity = variant[vk]
        if (
          isNew
            ? !clientRef(identity) || refs.has(identity)
            : fresh || !validId(identity) || codes.has(identity)
        ) {
          fail(`${vp}.${vk}`)
          continue
        }
        if (isNew) refs.add(identity as string)
        else codes.add(identity as string)
        const { label, volumeMl, priceCents } = variant
        if (
          !validText(label, true) ||
          !(
            validVolume(volumeMl) ||
            (volumeMl === null && !['chopes', 'cachacas'].includes(category.id))
          ) ||
          !(validCents(priceCents) || (priceCents === null && category.id !== 'cachacas'))
        ) {
          fail(
            vp,
            'Informe label, volume positivo e preço em centavos inteiros; null representa variante não comercializada.',
          )
          continue
        }
        if (
          !isNew &&
          category.id === 'chopes' &&
          ((identity === '30' && volumeMl !== 30000) || (identity === '50' && volumeMl !== 50000))
        ) {
          fail(`${vp}.volumeMl`)
          continue
        }
        command.variants.push({
          itemId: id,
          code: isNew ? `v_${crypto.randomUUID()}` : (identity as string),
          isNew,
          creationRef: isNew ? (identity as string) : null,
          label,
          volumeMl,
          priceCents,
          position: vi,
        })
      }
      if (item.visible && !command.variants.some((v) => v.itemId === id && v.priceCents !== null))
        fail(`${p}.variants`, 'Item visível exige pelo menos um preço.')
    }
  }
  if (
    command.items.length > EXPANSION_LIMITS.items ||
    command.variants.length > EXPANSION_LIMITS.variants
  )
    fail('catalog', 'Limite de itens ou variantes excedido.')
  return Object.keys(fields).length ? { fields } : { value: command }
}
