import type { ExpandedCatalog } from '../../shared/catalog'
import { centsToReais } from '../../shared/money'
import { requireAdmin } from '../auth/guard'
import { type AuthEnv, authError, authJson, wrongMethod } from '../auth/http'
import { catalogFailure } from './handlers'
import { expandedRepository } from './repository'

function projection(snapshot: ExpandedCatalog, positions: Record<string, number>) {
  const chopes = snapshot.categories.find((c) => c.id === 'chopes')?.items ?? []
  const cachacas = snapshot.categories.find((c) => c.id === 'cachacas')?.items ?? []
  if (
    snapshot.categories.map((c) => c.id).join(',') !== 'chopes,cachacas' ||
    snapshot.categories.some((c) => !['chopes', 'cachacas'].includes(c.id) && c.items.length) ||
    cachacas.length > 1 ||
    chopes.some(
      (i) =>
        i.variants.length !== 2 ||
        i.variants.map((v) => v.code).join(',') !== '30,50' ||
        !['30', '50'].every((code) =>
          i.variants.some(
            (v) =>
              v.code === code &&
              v.volumeMl === Number(code) * 1000 &&
              v.label === `Barril de ${code} L`,
          ),
        ),
    ) ||
    cachacas.some(
      (i) =>
        i.variants.length !== 1 ||
        i.variants[0].code !== 'bottle' ||
        i.variants[0].label !== 'Garrafa' ||
        i.variants[0].volumeMl === null ||
        i.variants[0].priceCents === null,
    )
  )
    return null
  return {
    products: chopes.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      visible: i.visible,
      sortOrder: positions[i.id],
      pricesCents: {
        30: i.variants.find((v) => v.code === '30')?.priceCents ?? null,
        50: i.variants.find((v) => v.code === '50')?.priceCents ?? null,
      },
    })),
    cachacas: cachacas.map((i) => ({
      id: i.id,
      title: i.name,
      description: i.description,
      visible: i.visible,
      bottleMl: i.variants[0].volumeMl as number,
      priceCents: i.variants[0].priceCents as number,
    })),
  }
}
const incompatible = () =>
  authJson(
    { error: { code: 'CATALOG_REQUIRES_NEW_CLIENT', message: 'Use o contrato de catálogo v2.' } },
    409,
  )

export async function handleLegacyPublic(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== 'GET') return wrongMethod(request, 'GET')
  try {
    const result = await expandedRepository(db).load()
    // Filter legitimate visibility before testing representability, never drop extra variants.
    const projected = projection(
      {
        ...result.snapshot,
        categories: result.snapshot.categories.map((c) => ({
          ...c,
          items: c.items.filter((i) => i.visible),
        })),
      },
      result.positions,
    )
    if (!projected) return incompatible()
    const bottle = projected.cachacas[0]
    return authJson({
      products: projected.products.map(({ sortOrder: _order, pricesCents, ...i }) => ({
        ...i,
        prices: {
          30: pricesCents[30] === null ? null : centsToReais(pricesCents[30]),
          50: pricesCents[50] === null ? null : centsToReais(pricesCents[50]),
        },
      })),
      cachaca: bottle
        ? {
            id: bottle.id,
            title: bottle.title,
            description: bottle.description,
            bottleMl: bottle.bottleMl,
            price: centsToReais(bottle.priceCents),
          }
        : null,
    })
  } catch {
    return catalogFailure()
  }
}

/** Production adapters never invoke the archived 0004 writers. */
export async function handleLegacyAdmin(
  request: Request,
  env: AuthEnv,
  resource: 'products' | 'cachacas' | 'catalog' | 'item',
): Promise<Response> {
  const allowed =
    resource === 'item' ? ['PATCH'] : resource === 'catalog' ? ['GET', 'PUT'] : ['GET']
  if (!allowed.includes(request.method)) return wrongMethod(request, allowed.join(', '))
  const auth = await requireAdmin(request, env)
  if (auth.error) return auth.error
  try {
    const result = await expandedRepository(env.DELEGAS_DB, auth).load()
    if (!result.authorized) return authError('UNAUTHENTICATED', 401)
    if (request.method !== 'GET')
      return authJson(
        {
          error: {
            code: 'ENDPOINT_RETIRED',
            message: 'Use PUT /api/admin/catalog/v2 com If-Match.',
          },
        },
        410,
      )
    const p = projection(result.snapshot, result.positions)
    if (!p) return incompatible()
    if (resource === 'products' || resource === 'cachacas')
      return authJson({ [resource]: p[resource] })
    const s = {
      revision: result.snapshot.revision,
      chopes: p.products.map(({ id, name, description, visible, pricesCents }) => ({
        id,
        name,
        description,
        visible,
        prices: pricesCents,
      })),
      cachacas: p.cachacas.map(({ id, title, description, visible, priceCents }) => ({
        id,
        name: title,
        description,
        visible,
        prices: { bottle: priceCents },
      })),
    }
    return authJson(s, 200, { ETag: `"${s.revision}"` })
  } catch {
    return catalogFailure()
  }
}
