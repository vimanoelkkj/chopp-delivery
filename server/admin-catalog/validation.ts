import { centsToReais } from '../../shared/money'
import type { CachacaPatch, ProductPatch, ValidationResult } from './contracts'

export const PATCH_BODY_LIMIT = 16384
export const PATCH_BODY_TIMEOUT_MS = 5000
export const MAX_PRICE_CENTS = 9_999_999

/** JSON limitado em bytes reais e duração, sem confiar no Content-Length. */
export async function readPatchBody(request: Request): Promise<{ value: unknown } | null> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json' ||
    !request.body
  )
    return null
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Prazo de leitura excedido'))
      void reader.cancel().catch(() => {})
    }, PATCH_BODY_TIMEOUT_MS)
  })
  try {
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      length += value.byteLength
      if (length > PATCH_BODY_LIMIT) {
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function containsControls(value: string, multiline = false): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return (code < 32 || code === 127) && !(multiline && [9, 10, 13].includes(code))
  })
}

export function malformedUnicode(value: string): boolean {
  return [...value].some(
    (character) =>
      character.length === 1 &&
      character.charCodeAt(0) >= 0xd800 &&
      character.charCodeAt(0) <= 0xdfff,
  )
}

export function unsafeUnicode(value: string): boolean {
  return malformedUnicode(value) || /\p{Bidi_Control}/u.test(value)
}

function hasVisibleCharacter(value: string): boolean {
  const visible = value.replace(
    /[\p{Default_Ignorable_Code_Point}\p{White_Space}\p{Mark}\u2800]/gu,
    '',
  )
  return /[\p{Letter}\p{Number}\p{Punctuation}\p{Symbol}]/u.test(visible)
}

function validText(value: unknown, name: boolean): value is string {
  return (
    typeof value === 'string' &&
    !unsafeUnicode(value) &&
    [...value].length <= (name ? 120 : 2000) &&
    (name ? hasVisibleCharacter(value) && !containsControls(value) : !containsControls(value, true))
  )
}

function validCents(value: unknown): value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_PRICE_CENTS
  )
    return false
  try {
    centsToReais(value)
    return true
  } catch {
    return false
  }
}

const centsMessage = 'Use centavos inteiros entre 1 e 9999999.'

export function productPricingFields(
  prices: { 30: number | null; 50: number | null },
  visible: boolean,
): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const size of [30, 50] as const)
    if (prices[size] !== null && !validCents(prices[size]))
      fields[`pricesCents.${size}`] = centsMessage
  if (visible && ![prices[30], prices[50]].some(validCents))
    fields.pricesCents = 'Informe ao menos um preço válido ou oculte o produto.'
  return fields
}

function allowedObject(data: unknown, allowed: string[]): Record<string, unknown> | null {
  return object(data) &&
    Object.keys(data).length > 0 &&
    Object.keys(data).every((key) => allowed.includes(key))
    ? data
    : null
}

export function validateProductPatch(data: unknown): ValidationResult<ProductPatch> {
  const fields: Record<string, string> = {}
  const input = allowedObject(data, ['name', 'description', 'pricesCents', 'visible', 'sortOrder'])
  if (!input)
    return { fields: { body: 'Envie um objeto não vazio contendo somente os campos permitidos.' } }
  const value: ProductPatch = {}
  if ('name' in input) {
    if (validText(input.name, true)) value.name = input.name
    else
      fields.name = 'Use nome visível com até 120 caracteres, Unicode válido e sem controles bidi.'
  }
  if ('description' in input) {
    if (validText(input.description, false)) value.description = input.description
    else
      fields.description =
        'Use Unicode válido com até 2000 caracteres, sem controles bidi; tabulação e quebras de linha são permitidas.'
  }
  if ('visible' in input) {
    if (typeof input.visible === 'boolean') value.visible = input.visible
    else fields.visible = 'Use true ou false.'
  }
  if ('sortOrder' in input) {
    if (
      typeof input.sortOrder === 'number' &&
      Number.isInteger(input.sortOrder) &&
      input.sortOrder >= 0 &&
      input.sortOrder <= 2147483647
    )
      value.sortOrder = input.sortOrder
    else fields.sortOrder = 'Use um inteiro entre 0 e 2147483647.'
  }
  if ('pricesCents' in input) {
    const prices = allowedObject(input.pricesCents, ['30', '50'])
    if (!prices) fields.pricesCents = 'Informe ao menos um dos tamanhos 30 ou 50.'
    else {
      value.pricesCents = {}
      for (const size of [30, 50] as const)
        if (String(size) in prices) {
          const price = prices[size]
          if (price === null || validCents(price)) value.pricesCents[size] = price
          else
            fields[`pricesCents.${size}`] =
              `${centsMessage} Use null somente para tamanho não comercializado.`
        }
    }
  }
  return Object.keys(fields).length ? { fields } : { value }
}

export function validateCachacaPatch(data: unknown): ValidationResult<CachacaPatch> {
  const fields: Record<string, string> = {}
  const input = allowedObject(data, ['title', 'description', 'priceCents', 'visible'])
  if (!input)
    return { fields: { body: 'Envie um objeto não vazio contendo somente os campos permitidos.' } }
  const value: CachacaPatch = {}
  if ('title' in input) {
    if (validText(input.title, true)) value.title = input.title
    else
      fields.title =
        'Use título visível com até 120 caracteres, Unicode válido e sem controles bidi.'
  }
  if ('description' in input) {
    if (validText(input.description, false)) value.description = input.description
    else
      fields.description =
        'Use Unicode válido com até 2000 caracteres, sem controles bidi; tabulação e quebras de linha são permitidas.'
  }
  if ('visible' in input) {
    if (typeof input.visible === 'boolean') value.visible = input.visible
    else fields.visible = 'Use true ou false.'
  }
  if ('priceCents' in input) {
    if (validCents(input.priceCents)) value.priceCents = input.priceCents
    else fields.priceCents = centsMessage
  }
  return Object.keys(fields).length ? { fields } : { value }
}
