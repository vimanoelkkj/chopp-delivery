import type { ExpandedCatalog } from '../../shared/catalog'
import { revisionToken } from '../admin-catalog/catalog-contract'
import { validCents, validText } from '../admin-catalog/validation'
import type { AuthConfig } from '../auth/http'
import { type AdminPrincipal, adminWriteProof } from '../auth/session'
import { type CatalogCommand, validId, validVolume } from './validation'

type Authorization = { principal: AdminPrincipal; config: AuthConfig }
type Row = Record<string, unknown>
export function expandedRepository(db: D1Database, authorization?: Authorization) {
  const proof = authorization
    ? adminWriteProof(authorization.principal, authorization.config)
    : { sql: '1', values: [] }
  const reads = () => [
    db
      .prepare(
        `SELECT revision, EXISTS(SELECT 1 FROM catalog_ready) AS ready, ${proof.sql} AS authorized FROM catalog_meta WHERE singleton=1`,
      )
      .bind(...proof.values),
    db.prepare('SELECT * FROM catalog_categories ORDER BY sort_order,id'),
    db.prepare('SELECT * FROM catalog_items ORDER BY category_id,sort_order,id'),
    db.prepare('SELECT * FROM catalog_variants ORDER BY item_id,sort_order,code'),
  ]
  const decode = (results: D1Result[]) => {
    if (results.length !== 4 || results.some((r) => !r.success) || results[0].results.length !== 1)
      throw new Error('CATALOG_UNAVAILABLE')
    const meta = results[0].results[0] as Row
    if (meta.ready !== 1) throw new Error('CATALOG_SCHEMA_UNAVAILABLE')
    const snapshot: ExpandedCatalog = {
      revision: revisionToken(meta.revision as number),
      categories: [],
    }
    const categories = new Map<string, ExpandedCatalog['categories'][number]>()
    const items = new Map<string, ExpandedCatalog['categories'][number]['items'][number]>()
    const positions: Record<string, number> = Object.create(null)
    const ref = (v: unknown): v is string | null =>
      v === null || (typeof v === 'string' && /^tmp:[0-9a-f-]{36}$/.test(v) && v.length === 40)
    for (const r of results[1].results as Row[]) {
      if (!validId(r.id) || !validText(r.name, true) || categories.has(r.id))
        throw new Error('CATALOG_INVALID')
      const category = { id: r.id, name: r.name, items: [] }
      categories.set(r.id, category)
      snapshot.categories.push(category)
    }
    for (const r of results[2].results as Row[]) {
      const category = categories.get(r.category_id as string)
      if (
        !category ||
        !validId(r.id) ||
        items.has(r.id) ||
        !ref(r.creation_ref) ||
        !validText(r.name, true) ||
        !validText(r.description, false) ||
        ![0, 1].includes(r.visible as number)
      )
        throw new Error('CATALOG_INVALID')
      const item = {
        id: r.id,
        creationRef: r.creation_ref,
        name: r.name,
        description: r.description,
        visible: r.visible === 1,
        variants: [],
      }
      items.set(r.id, item)
      category.items.push(item)
      positions[r.id] = r.sort_order as number
    }
    for (const r of results[3].results as Row[]) {
      const item = items.get(r.item_id as string)
      if (
        !item ||
        !validId(r.code) ||
        !ref(r.creation_ref) ||
        !validText(r.label, true) ||
        !(r.volume_ml === null || validVolume(r.volume_ml)) ||
        !(r.price_cents === null || validCents(r.price_cents)) ||
        item.variants.some((v) => v.code === r.code)
      )
        throw new Error('CATALOG_INVALID')
      item.variants.push({
        code: r.code,
        creationRef: r.creation_ref,
        label: r.label,
        volumeMl: r.volume_ml,
        priceCents: r.price_cents,
      })
    }
    for (const c of snapshot.categories)
      for (const i of c.items) {
        if (
          !i.variants.length ||
          (i.visible && !i.variants.some((v) => v.priceCents !== null)) ||
          i.variants.some(
            (v) =>
              (['chopes', 'cachacas'].includes(c.id) && v.volumeMl === null) ||
              (c.id === 'cachacas' && v.priceCents === null),
          )
        )
          throw new Error('CATALOG_INVALID')
      }
    return { snapshot, positions, authorized: meta.authorized === 1 }
  }
  return {
    async load() {
      return decode(await db.batch(reads()))
    },
    async save(command: CatalogCommand, revision: number) {
      if (!authorization) throw new Error('Authorization required')
      const [receipt, ...state] = await db.batch([
        db
          .prepare(
            `UPDATE catalog_write SET payload=?, session_hash=?, user_id=?, origin=? WHERE singleton=1 AND revision=? AND EXISTS(SELECT 1 FROM catalog_ready) AND ${proof.sql} RETURNING 1 AS accepted`,
          )
          .bind(JSON.stringify(command), ...proof.values, revision, ...proof.values),
        ...reads(),
      ])
      const current = decode(state)
      if (!receipt.success || receipt.results.length > 1) throw new Error('CATALOG_UNAVAILABLE')
      return {
        ...current,
        status:
          receipt.results.length === 1 ? 'ok' : current.authorized ? 'conflict' : 'unauthorized',
      } as const
    },
  }
}

export function publicSnapshot(snapshot: ExpandedCatalog) {
  return {
    revision: snapshot.revision,
    categories: snapshot.categories.map((c) => ({
      id: c.id,
      name: c.name,
      items: c.items
        .filter((i) => i.visible)
        .map(({ creationRef: _ref, variants, ...item }) => ({
          ...item,
          variants: variants.map(({ creationRef: _ref, ...variant }) => variant),
        })),
    })),
  }
}
