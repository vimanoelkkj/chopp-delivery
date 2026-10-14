import type { ValidationResult } from './contracts'
import {
  containsControls,
  productPricingFields,
  unsafeUnicode,
  validCents,
  validText,
} from './validation'

// Estrutura compatível com AdminCatalogGateway da F3B (7fab0c5), sem importar seu worktree.
export type CatalogItem = {
  id: string
  name: string
  description: string
  visible: boolean
  prices: Partial<Record<'30' | '50' | 'bottle', number | null>>
}
export type CatalogSnapshot = { revision: string; chopes: CatalogItem[]; cachacas: CatalogItem[] }
export const CATALOG_BODY_LIMIT = 131072

export function revisionToken(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Revisão indisponível')
  return `r${revision}`
}

export function parseIfMatch(header: string): number | null {
  const match = /^"r(0|[1-9][0-9]{0,15})"$/.exec(header)
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : null
}

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

export function validateCatalog(data: unknown, token: string): ValidationResult<CatalogSnapshot> {
  const fields: Record<string, string> = {}
  if (!exact(data, ['revision', 'chopes', 'cachacas']))
    return { fields: { catalog: 'Informe revision, chopes e cachacas, sem campos adicionais.' } }
  if (data.revision !== token)
    fields.revision = 'A revisão do corpo deve ser igual à precondição If-Match.'
  if (!Array.isArray(data.chopes) || !Array.isArray(data.cachacas))
    return { fields: { catalog: 'Chopes e cachaças devem ser listas.' } }
  if (data.chopes.length + data.cachacas.length > 128 || data.cachacas.length > 1)
    return { fields: { catalog: 'Quantidade de registros inválida.' } }
  const parsed: CatalogSnapshot = { revision: token, chopes: [], cachacas: [] }
  const lists: Record<'chopes' | 'cachacas', unknown[]> = {
    chopes: data.chopes,
    cachacas: data.cachacas,
  }
  const ids = new Set<string>()
  for (const group of ['chopes', 'cachacas'] as const) {
    for (const [index, input] of lists[group].entries()) {
      const prefix = `${group}.${index}`
      if (!exact(input, ['id', 'name', 'description', 'visible', 'prices'])) {
        fields[prefix] = 'Informe somente id, name, description, visible e prices.'
        continue
      }
      const id = input.id
      if (
        typeof id !== 'string' ||
        !id.length ||
        id.length > 128 ||
        containsControls(id) ||
        unsafeUnicode(id) ||
        ids.has(id)
      ) {
        fields[`${prefix}.id`] = 'Identificador inválido ou repetido.'
        continue
      }
      ids.add(id)
      const { name, description, visible, prices } = input
      if (!validText(name, true))
        fields[`${prefix}.name`] =
          'Use nome visível com Unicode válido, até 120 caracteres e sem controles bidi.'
      if (!validText(description, false))
        fields[`${prefix}.description`] =
          'Use descrição Unicode válida com até 2000 caracteres e sem controles bidi.'
      if (typeof visible !== 'boolean') fields[`${prefix}.visible`] = 'Use true ou false.'
      const slots = group === 'chopes' ? ['30', '50'] : ['bottle']
      if (!exact(prices, slots)) {
        fields[`${prefix}.prices`] =
          `Informe somente os preços ${slots.join(', ')}; barris não vendidos devem ser null.`
        continue
      }
      let pricesValid = true
      for (const slot of slots) {
        const value = prices[slot]
        if (!(group === 'chopes' && value === null) && !validCents(value)) {
          fields[`${prefix}.prices.${slot}`] = 'Use centavos inteiros entre 1 e 9999999.'
          pricesValid = false
        }
      }
      if (
        pricesValid &&
        group === 'chopes' &&
        visible === true &&
        prices['30'] === null &&
        prices['50'] === null
      )
        fields[`${prefix}.prices`] = 'Informe ao menos um preço válido ou oculte o produto.'
      if (
        validText(name, true) &&
        validText(description, false) &&
        typeof visible === 'boolean' &&
        pricesValid
      ) {
        const item: CatalogItem = {
          id,
          name,
          description,
          visible,
          prices:
            group === 'chopes'
              ? { 30: prices['30'] as number | null, 50: prices['50'] as number | null }
              : { bottle: prices.bottle as number },
        }
        if (
          group === 'chopes' &&
          Object.keys(
            productPricingFields(
              { 30: item.prices['30'] ?? null, 50: item.prices['50'] ?? null },
              visible,
            ),
          ).length
        )
          continue
        parsed[group].push(item)
      }
    }
  }
  return Object.keys(fields).length ? { fields } : { value: parsed }
}
