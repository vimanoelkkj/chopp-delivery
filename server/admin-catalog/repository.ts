import type { AuthConfig } from '../auth/http'
import { type AdminPrincipal, adminWriteProof } from '../auth/session'
import type {
  AdminCachaca,
  AdminProduct,
  CachacaPatch,
  CatalogResource,
  MutationResult,
  ProductPatch,
} from './contracts'
import { MAX_PRICE_CENTS, productPricingFields, validateCachacaPatch } from './validation'

type ProductRow = {
  id: string
  name: string
  description: string
  price_30_cents: number | null
  price_50_cents: number | null
  visible: number
  sort_order: number
}
type CachacaRow = {
  id: string
  title: string
  description: string
  bottle_ml: number
  price_cents: number
  visible: number
}
type Row = ProductRow | CachacaRow
type WritableColumn =
  | 'name'
  | 'description'
  | 'visible'
  | 'sort_order'
  | 'price_30_cents'
  | 'price_50_cents'
  | 'title'
  | 'price_cents'
type Assignment = [column: WritableColumn, value: string | number | null]

const resources = {
  products: {
    table: 'products',
    columns: 'id, name, description, price_30_cents, price_50_cents, visible, sort_order',
    order: 'sort_order, id',
  },
  cachacas: {
    table: 'cachaca',
    columns: 'id, title, description, bottle_ml, price_cents, visible',
    order: 'id',
  },
} as const

function product(row: ProductRow): AdminProduct {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    pricesCents: { 30: row.price_30_cents, 50: row.price_50_cents },
    visible: row.visible === 1,
    sortOrder: row.sort_order,
  }
}
function cachaca(row: CachacaRow): AdminCachaca {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    bottleMl: row.bottle_ml,
    priceCents: row.price_cents,
    visible: row.visible === 1,
  }
}

/** API fechada: handlers não recebem SQL ou caminho de escrita sem prova. */
export function createAdminCatalogRepository(
  db: D1Database,
  authorization: { principal: AdminPrincipal; config: AuthConfig },
) {
  const proof = adminWriteProof(authorization.principal, authorization.config)
  const authorizationQuery = () =>
    db.prepare(`SELECT ${proof.sql} AS authorized`).bind(...proof.values)

  async function list(resource: CatalogResource): Promise<{ authorized: boolean; rows: Row[] }> {
    const definition = resources[resource]
    const [access, data] = await db.batch<Row | { authorized: number }>([
      authorizationQuery(),
      db.prepare(
        `SELECT ${definition.columns} FROM ${definition.table} ORDER BY ${definition.order}`,
      ),
    ])
    if (!access.success || !data.success || access.results.length !== 1)
      throw new Error('Leitura administrativa indisponível')
    return {
      authorized: (access.results[0] as { authorized: number }).authorized === 1,
      rows: data.results as Row[],
    }
  }

  async function mutate(
    resource: CatalogResource,
    id: string,
    assignments: Assignment[],
  ): Promise<MutationResult<Row>> {
    if (!assignments.length) throw new Error('Mutação sem campos')
    const definition = resources[resource]
    const values = assignments.map(([, value]) => value)
    const stateValues: (string | number | null)[] = []
    const projected = (column: WritableColumn) => {
      const assignment = assignments.find(([name]) => name === column)
      if (!assignment) return column
      stateValues.push(assignment[1])
      return '?'
    }
    // O estado final é validado no WHERE, inclusive entre PATCHs concorrentes.
    const state =
      resource === 'products'
        ? `EXISTS (SELECT 1 FROM (SELECT ${projected('price_30_cents')} AS p30, ${projected('price_50_cents')} AS p50, ${projected('visible')} AS shown)
          WHERE (p30 IS NULL OR p30 BETWEEN 1 AND ${MAX_PRICE_CENTS})
            AND (p50 IS NULL OR p50 BETWEEN 1 AND ${MAX_PRICE_CENTS})
            AND (shown = 0 OR p30 BETWEEN 1 AND ${MAX_PRICE_CENTS} OR p50 BETWEEN 1 AND ${MAX_PRICE_CENTS}))`
        : `EXISTS (SELECT 1 FROM (SELECT ${projected('price_cents')} AS price) WHERE price BETWEEN 1 AND ${MAX_PRICE_CENTS})`
    // Nomes vêm exclusivamente dos métodos abaixo; nenhum identificador vem do JSON.
    const [update, access, data] = await db.batch<Row | { authorized: number }>([
      db
        .prepare(`UPDATE ${definition.table} SET ${assignments.map(([column]) => `${column} = ?`).join(', ')}
        WHERE id = ? AND ${proof.sql}
          AND (${assignments.map(([column]) => `${column} IS NOT ?`).join(' OR ')})
          AND ${state}
        RETURNING ${definition.columns}`)
        .bind(...values, id, ...proof.values, ...values, ...stateValues),
      authorizationQuery(),
      db.prepare(`SELECT ${definition.columns} FROM ${definition.table} WHERE id = ?`).bind(id),
    ])
    if (
      !update.success ||
      !access.success ||
      !data.success ||
      access.results.length !== 1 ||
      update.results.length > 1 ||
      data.results.length > 1
    )
      throw new Error('Mutação administrativa indisponível')
    if (update.results.length === 1)
      return { status: 'ok', item: update.results[0] as Row, changed: true }
    // Diagnóstico posterior na mesma transação: não confunde revogação com 404/no-op.
    if ((access.results[0] as { authorized: number }).authorized !== 1)
      return { status: 'unauthorized' }
    const item = data.results[0] as Row | undefined
    if (!item) return { status: 'missing' }
    const next = { ...item, ...Object.fromEntries(assignments) }
    const fields =
      resource === 'products'
        ? productPricingFields(product(next as ProductRow).pricesCents, next.visible === 1)
        : validateCachacaPatch({ priceCents: (next as CachacaRow).price_cents }).fields
    if (fields && Object.keys(fields).length) return { status: 'invalid', fields }
    if (
      !assignments.every(([column, value]) =>
        Object.entries(item).some(([key, stored]) => key === column && stored === value),
      )
    )
      throw new Error('Mutação não confirmada')
    return { status: 'ok', item, changed: false }
  }

  return {
    async listProducts() {
      const result = await list('products')
      return { authorized: result.authorized, items: (result.rows as ProductRow[]).map(product) }
    },
    async listCachacas() {
      const result = await list('cachacas')
      return { authorized: result.authorized, items: (result.rows as CachacaRow[]).map(cachaca) }
    },
    async updateProduct(id: string, patch: ProductPatch): Promise<MutationResult<AdminProduct>> {
      const assignments: Assignment[] = []
      if (patch.name !== undefined) assignments.push(['name', patch.name])
      if (patch.description !== undefined) assignments.push(['description', patch.description])
      if (patch.visible !== undefined) assignments.push(['visible', Number(patch.visible)])
      if (patch.sortOrder !== undefined) assignments.push(['sort_order', patch.sortOrder])
      for (const size of [30, 50] as const)
        if (patch.pricesCents?.[size] !== undefined)
          assignments.push([
            size === 30 ? 'price_30_cents' : 'price_50_cents',
            patch.pricesCents[size],
          ])
      const result = await mutate('products', id, assignments)
      return result.status === 'ok'
        ? { ...result, item: product(result.item as ProductRow) }
        : result
    },
    async updateCachaca(id: string, patch: CachacaPatch): Promise<MutationResult<AdminCachaca>> {
      const assignments: Assignment[] = []
      if (patch.title !== undefined) assignments.push(['title', patch.title])
      if (patch.description !== undefined) assignments.push(['description', patch.description])
      if (patch.visible !== undefined) assignments.push(['visible', Number(patch.visible)])
      if (patch.priceCents !== undefined) assignments.push(['price_cents', patch.priceCents])
      const result = await mutate('cachacas', id, assignments)
      return result.status === 'ok'
        ? { ...result, item: cachaca(result.item as CachacaRow) }
        : result
    },
  }
}
