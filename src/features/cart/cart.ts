import { MAX_ORDER_QUANTITY, normalizeQuantity } from '@/shared/lib/quantity'

/** Uma linha do pedido: item + variante, com o preço (em centavos) visto quando foi adicionada. */
export type CartLine = {
  itemId: string
  variantCode: string
  name: string
  label: string
  unitPriceCents: number
  quantity: number
}

export const CART_STORAGE_KEY = 'chopp-delivery:cart:v1'
/** Limite de linhas distintas: protege o localStorage e o tamanho da mensagem do WhatsApp. */
export const MAX_CART_LINES = 40

export const lineKey = (line: Pick<CartLine, 'itemId' | 'variantCode'>) =>
  `${line.itemId}:${line.variantCode}`

/** Identifica o conteúdo exato do pedido (item, variante, quantidade e preço) para invalidar conferências. */
export const cartSignature = (lines: readonly CartLine[]) =>
  lines.map((l) => `${lineKey(l)}:${l.quantity}:${l.unitPriceCents}`).join('|')

export const lineSubtotalCents = (line: CartLine) => line.unitPriceCents * line.quantity

export const cartTotalCents = (lines: readonly CartLine[]) =>
  lines.reduce((sum, line) => sum + lineSubtotalCents(line), 0)

export const cartUnitCount = (lines: readonly CartLine[]) =>
  lines.reduce((sum, line) => sum + line.quantity, 0)

/** Soma na linha existente (mesmo item e variante) ou cria uma nova. Quantidade limitada a 99. */
export function addToCart(lines: readonly CartLine[], line: CartLine): CartLine[] {
  const key = lineKey(line)
  const existing = lines.find((l) => lineKey(l) === key)
  if (existing) {
    return lines.map((l) =>
      l === existing
        ? {
            ...l,
            name: line.name,
            label: line.label,
            unitPriceCents: line.unitPriceCents,
            quantity: Math.min(MAX_ORDER_QUANTITY, l.quantity + normalizeQuantity(line.quantity)),
          }
        : l,
    )
  }
  if (lines.length >= MAX_CART_LINES) return [...lines]
  return [...lines, { ...line, quantity: normalizeQuantity(line.quantity) }]
}

export function setLineQuantity(lines: readonly CartLine[], key: string, quantity: number) {
  return lines.map((l) =>
    lineKey(l) === key ? { ...l, quantity: normalizeQuantity(quantity) } : l,
  )
}

export const removeLine = (lines: readonly CartLine[], key: string) =>
  lines.filter((l) => lineKey(l) !== key)

const isCents = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= 9_999_999

const isText = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.length <= 200

/** Lê o que veio do localStorage. Dado corrompido nunca derruba a página: linhas inválidas caem. */
export function parseStoredCart(raw: string | null): CartLine[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (
    typeof data !== 'object' ||
    data === null ||
    !Array.isArray((data as { lines?: unknown }).lines)
  )
    return []
  let lines: CartLine[] = []
  for (const value of (data as { lines: unknown[] }).lines) {
    if (typeof value !== 'object' || value === null) continue
    const v = value as Record<string, unknown>
    if (
      !isText(v.itemId) ||
      !isText(v.variantCode) ||
      !isText(v.name) ||
      !isText(v.label) ||
      !isCents(v.unitPriceCents) ||
      typeof v.quantity !== 'number' ||
      !Number.isSafeInteger(v.quantity) ||
      v.quantity < 1
    )
      continue
    lines = addToCart(lines, {
      itemId: v.itemId,
      variantCode: v.variantCode,
      name: v.name,
      label: v.label,
      unitPriceCents: v.unitPriceCents,
      quantity: v.quantity,
    })
  }
  return lines
}

export const serializeCart = (lines: readonly CartLine[]) => JSON.stringify({ v: 1, lines })
