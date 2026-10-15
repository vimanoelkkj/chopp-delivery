/** Categoria existente (estrutural nesta fase: o painel não cria nem renomeia categorias). */
export type CategoryId = string

/** Variação comercial de um item (tamanho de barril, garrafa…). `priceCents` null = não vendida. */
export type AdminVariant = {
  code: string
  /** clientId (`tmp:<UUID>`) com que a variante foi criada; null nas legadas. Somente leitura. */
  creationRef?: string | null
  label: string
  volumeMl: number | null
  priceCents: number | null
}

export type AdminItem = {
  id: string
  /** clientId (`tmp:<UUID>`) com que o item foi criado; null nos legados. Somente leitura. */
  creationRef?: string | null
  name: string
  description: string
  visible: boolean
  variants: AdminVariant[]
}

export type AdminCategory = { id: CategoryId; name: string; items: AdminItem[] }

/** Snapshot completo; `revision` é o token opaco da revisão otimista (ver docs). */
export type AdminCatalog = { revision: string; categories: AdminCategory[] }

/**
 * Entradas de salvamento. Persistidos levam `id`/`code`; novos levam `clientId` temporário
 * (`tmp:<UUID>`), nunca os dois. Variantes são sempre referenciadas junto do item pai.
 */
export type VariantInput = ({ code: string } | { clientId: string }) & {
  label: string
  volumeMl: number | null
  priceCents: number | null
}
export type ItemInput = ({ id: string } | { clientId: string }) & {
  name: string
  description: string
  visible: boolean
  variants: VariantInput[]
}
export type SaveInput = {
  revision: string
  /** `name` é o do snapshot GET, devolvido sem edição: o servidor exige `{ id, name, items }`. */
  categories: { id: CategoryId; name: string; items: ItemInput[] }[]
}
export type SaveResult = {
  catalog: AdminCatalog
  created: {
    items: { clientId: string; id: string }[]
    variants: { itemId: string; clientId: string; code: string }[]
  }
}

export type AdminUser = { id: string; username: string }

/**
 * Colunas da tabela para itens "padrão" (os legados: barris 30/50 e garrafa). Itens com outra
 * forma de variantes usam o cartão de produto. Nada aqui define regra de negócio nova.
 */
export const STANDARD_COLUMNS: Record<CategoryId, readonly { code: string; label: string }[]> = {
  chopes: [
    { code: '30', label: '30 L (R$)' },
    { code: '50', label: '50 L (R$)' },
  ],
  cachacas: [{ code: 'bottle', label: 'Garrafa (R$)' }],
}

/** Categorias cujas variantes exigem preço (cachaça). Nas demais, null = não vendida. */
export const PRICE_REQUIRED: ReadonlySet<CategoryId> = new Set(['cachacas'])

export const EMPTY_TITLE: Record<CategoryId, string> = {
  chopes: 'Nenhum chope ainda',
  cachacas: 'Nenhuma cachaça ainda',
}

export const NAME_MAX = 120
export const DESCRIPTION_MAX = 2000
export const LABEL_MAX = 60
export const VOLUME_MAX_ML = 100_000_000
