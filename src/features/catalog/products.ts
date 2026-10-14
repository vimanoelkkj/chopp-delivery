import type { Cachaca, Product } from './types'

/**
 * Dados iniciais de demonstração, copiados da tabela de valores enviada pelo estabelecimento.
 * Sujeitos à confirmação comercial. Fotos ainda não existem.
 */
export const products: Product[] = [
  {
    id: 'dronken',
    name: 'Dronken',
    description: 'Double Double',
    prices: { 30: 510, 50: 650 },
    visible: true,
  },
  {
    id: 'palato-beber',
    name: 'Palato Beber',
    description: 'Premium Lager Pilsen',
    prices: { 30: 490, 50: 640 },
    visible: true,
  },
  {
    id: 'villa-alema',
    name: 'Villa Alemã',
    // O PDF diverge: "Chopp alemão" na landing e "Chopp" no painel. A tabela original não traz
    // origem nem estilo, então fica o termo genérico até o estabelecimento confirmar.
    description: 'Chopp',
    prices: { 30: 520, 50: 670 },
    visible: true,
  },
  {
    id: 'krug-bier',
    name: 'Krug Bier',
    description: 'Chopp',
    prices: { 30: 570, 50: 760 },
    visible: true,
  },
  {
    id: 'brahma',
    name: 'Brahma',
    description: 'Chopp',
    prices: { 30: null, 50: 890 },
    visible: true,
  },
  {
    id: 'kaiser',
    name: 'Kaiser',
    description: 'Chopp',
    prices: { 30: null, 50: 890 },
    visible: true,
  },
  {
    id: 'heineken',
    name: 'Heineken',
    description: 'Chopp',
    prices: { 30: null, 50: 990 },
    visible: true,
  },
  {
    id: 'chopp-de-vinho',
    name: 'Chopp de vinho',
    description: 'Vinho',
    prices: { 30: 570, 50: 790 },
    visible: true,
  },
]

export const cachaca: Cachaca = {
  title: 'Temos cachaça',
  description: 'Conservada em barril de umburana com jequitibá rosa',
  bottleMl: 700,
  price: 30,
}
