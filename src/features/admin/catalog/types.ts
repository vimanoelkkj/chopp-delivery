/** Abas do painel. `chopes` mapeia os produtos; `cachacas`, a garrafa de cachaça. */
export type TabId = 'chopes' | 'cachacas'

/** Campo de preço editável de um item. Barris em litros; `bottle` é a garrafa de cachaça. */
export type PriceSlot = '30' | '50' | 'bottle'

export type SlotConfig = { slot: PriceSlot; label: string; required: boolean }

export const SLOTS: Record<TabId, readonly SlotConfig[]> = {
  chopes: [
    { slot: '30', label: '30 L (R$)', required: false },
    { slot: '50', label: '50 L (R$)', required: false },
  ],
  cachacas: [{ slot: 'bottle', label: 'Garrafa (R$)', required: true }],
}

export const TAB_LABELS: Record<TabId, string> = { chopes: 'Chopes', cachacas: 'Cachaças' }
export const TAB_IDS: readonly TabId[] = ['chopes', 'cachacas']

/** Item editável. Preços em centavos; `null` = não vendido naquele tamanho. */
export type AdminItem = {
  id: string
  name: string
  description: string
  visible: boolean
  prices: Partial<Record<PriceSlot, number | null>>
}

/**
 * Cada lista já vem na ordem de exibição do site. `revision` é um token opaco do servidor:
 * identifica a versão do catálogo em que a edição se baseou e protege contra sobrescrita
 * silenciosa (ver docs/admin-panel-ui.md, "Edição concorrente").
 */
export type AdminCatalog = { revision: string } & Record<TabId, AdminItem[]>

export type AdminUser = { id: string; username: string }
