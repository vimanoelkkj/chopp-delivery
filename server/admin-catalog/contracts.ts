export type CatalogResource = 'products' | 'cachacas'

export type AdminProduct = {
  id: string
  name: string
  description: string
  pricesCents: { 30: number | null; 50: number | null }
  visible: boolean
  sortOrder: number
}

export type AdminCachaca = {
  id: string
  title: string
  description: string
  bottleMl: number
  priceCents: number
  visible: boolean
}

export type ProductPatch = Partial<
  Pick<AdminProduct, 'name' | 'description' | 'visible' | 'sortOrder'>
> & {
  pricesCents?: Partial<AdminProduct['pricesCents']>
}
export type CachacaPatch = Partial<
  Pick<AdminCachaca, 'title' | 'description' | 'priceCents' | 'visible'>
>
export type ProductsResponse = { products: AdminProduct[] }
export type CachacasResponse = { cachacas: AdminCachaca[] }
export type ProductMutationResponse = { product: AdminProduct; changed: boolean }
export type CachacaMutationResponse = { cachaca: AdminCachaca; changed: boolean }
export type ValidationResult<T> =
  | { value: T; fields?: never }
  | { fields: Record<string, string>; value?: never }

export type MutationResult<T> =
  | { status: 'ok'; item: T; changed: boolean }
  | { status: 'unauthorized' }
  | { status: 'missing' }
  | { status: 'invalid'; fields: Record<string, string> }
