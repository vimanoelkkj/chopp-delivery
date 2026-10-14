import { centsToReais } from '../../shared/money'
import type { Catalog } from '../../src/features/catalog/types'

type ProductRow = {
  id: string
  name: string
  description: string
  price_30_cents: number | null
  price_50_cents: number | null
}

type CachacaRow = {
  id: string
  title: string
  description: string
  bottle_ml: number
  price_cents: number
}

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

export async function handleProducts(
  request: { method: string },
  db: Pick<D1Database, 'prepare' | 'batch'>,
): Promise<Response> {
  if (request.method !== 'GET') {
    const response = Response.json(
      { error: { code: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' } },
      { status: 405, headers: { ...headers, Allow: 'GET' } },
    )
    return request.method === 'HEAD' ? new Response(null, response) : response
  }

  try {
    // Duas leituras na mesma transação; visibilidade independe dos tamanhos vendidos.
    const [products, cachaca] = await db.batch<ProductRow | CachacaRow>([
      db
        .prepare(`SELECT id, name, description, price_30_cents, price_50_cents
        FROM products WHERE visible = ? ORDER BY sort_order, id`)
        .bind(1),
      db
        .prepare(`SELECT id, title, description, bottle_ml, price_cents
        FROM cachaca WHERE visible = ?`)
        .bind(1),
    ])
    if (!products.success || !cachaca.success) throw new Error('Falha na leitura D1')
    // Os tipos de cada SELECT são conhecidos e as tabelas são STRICT.
    const rows = products.results as ProductRow[]
    const bottle = (cachaca.results as CachacaRow[])[0]
    const catalog: Catalog = {
      products: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        visible: true,
        prices: {
          30: row.price_30_cents === null ? null : centsToReais(row.price_30_cents),
          50: row.price_50_cents === null ? null : centsToReais(row.price_50_cents),
        },
      })),
      cachaca: bottle
        ? {
            id: bottle.id,
            title: bottle.title,
            description: bottle.description,
            bottleMl: bottle.bottle_ml,
            price: centsToReais(bottle.price_cents),
          }
        : null,
    }
    return Response.json(catalog, { headers })
  } catch (error) {
    console.error('Falha ao ler o catálogo D1', error)
    return Response.json(
      { error: { code: 'CATALOG_UNAVAILABLE', message: 'Catálogo indisponível no momento.' } },
      { status: 503, headers },
    )
  }
}

export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  handleProducts(request, env.DELEGAS_DB)
