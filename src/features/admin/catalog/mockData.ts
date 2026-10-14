import type { AdminCatalog, AdminItem } from './types'

/**
 * DADOS MOCKADOS, só para a F3B. Espelham o seed D1 e o PDF aprovado. Saem de cena quando
 * o contrato administrativo da F3A existir (ver docs/admin-panel-ui.md).
 */
export function createMockCatalog(): AdminCatalog {
  const chope = (
    id: string,
    name: string,
    description: string,
    p30: number | null,
    p50: number | null,
    visible = true,
  ): AdminItem => ({ id, name, description, visible, prices: { '30': p30, '50': p50 } })
  return {
    revision: '1',
    chopes: [
      chope('dronken', 'Dronken', 'Double Double', 51000, 65000),
      chope('palato-beber', 'Palato Beber', 'Premium Lager Pilsen', 49000, 64000),
      chope('villa-alema', 'Villa Alemã', 'Chopp', 52000, 67000),
      chope('krug-bier', 'Krug Bier', 'Chopp', 57000, 76000),
      chope('brahma', 'Brahma', 'Chopp', null, 89000),
      chope('kaiser', 'Kaiser', 'Chopp', null, 89000),
      chope('heineken', 'Heineken', 'Chopp', null, 99000, false),
      chope('chopp-de-vinho', 'Chopp de vinho', 'Vinho', 57000, 79000),
    ],
    cachacas: [
      {
        id: 'cachaca',
        name: 'Cachaça',
        description: 'Garrafa de 700 ml, conservada em barril de umburana',
        visible: true,
        prices: { bottle: 3000 },
      },
    ],
  }
}
