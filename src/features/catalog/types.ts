/** Barris vendidos, em litros. */
export type BarrelSize = 30 | 50

export const BARREL_SIZES: readonly BarrelSize[] = [30, 50]

/** Preço em reais por tamanho. `null` significa que o produto não é vendido naquele tamanho. */
export type ProductPrices = Record<BarrelSize, number | null>

export type Product = {
  id: string
  name: string
  description: string
  prices: ProductPrices
  /** Controla se o produto aparece no site. Será editável no painel. */
  visible: boolean
}

export type Cachaca = {
  title: string
  description: string
  bottleMl: number
  price: number
}
