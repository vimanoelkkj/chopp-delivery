/** Aceita no máximo duas casas decimais; não arredonda valores comerciais. */
export function reaisToCents(value: number): number {
  if (!Number.isFinite(value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new Error('Preço em reais inválido')
  }
  const [whole, fraction = ''] = String(value).split('.')
  const cents = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')))
  if (!Number.isSafeInteger(cents)) throw new Error('Preço fora do limite seguro')
  return cents
}

export function centsToReais(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Centavos inválidos')
  const reais = value / 100
  if (reaisToCents(reais) !== value) throw new Error('Preço perderia precisão')
  return reais
}
