/**
 * Identidade comercial de uma variante dentro de um produto: rótulo normalizado + volume.
 * Compartilhada pelo painel e pelo servidor para que os dois recusem exatamente as mesmas
 * duplicatas. Mesmo volume com rótulos diferentes continua sendo válido.
 */
export function normalizeVariantLabel(label: string): string {
  return label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

export function variantIdentity(label: string, volumeMl: number | null): string {
  return `${normalizeVariantLabel(label)}|${volumeMl ?? 'sem-volume'}`
}

export const DUPLICATE_VARIANT_MESSAGE =
  'Já existe uma variante com este rótulo e volume neste produto.'
