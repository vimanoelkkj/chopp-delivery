import type { AuthConfig } from '../auth/http'
import { type AdminPrincipal, adminWriteProof } from '../auth/session'
import { type CatalogSnapshot, revisionToken } from './catalog-contract'

type ProductRow = {
  id: string
  name: string
  description: string
  visible: number
  price_30_cents: number | null
  price_50_cents: number | null
}
type BottleRow = {
  id: string
  title: string
  description: string
  visible: number
  price_cents: number
}
type SnapshotResult = { authorized: boolean; snapshot: CatalogSnapshot }
export type CatalogSaveResult =
  | { status: 'ok'; snapshot: CatalogSnapshot }
  | { status: 'unauthorized' }
  | { status: 'conflict' }

/** A única mutação exposta é o comando completo, condicionado por prova e revisão. */
export function createCatalogRepository(
  db: D1Database,
  authorization: { principal: AdminPrincipal; config: AuthConfig },
) {
  const proof = adminWriteProof(authorization.principal, authorization.config)
  const reads = () => [
    db.prepare(`SELECT ${proof.sql} AS authorized`).bind(...proof.values),
    db.prepare('SELECT revision FROM catalog_meta WHERE singleton = 1'),
    db.prepare(
      'SELECT id, name, description, visible, price_30_cents, price_50_cents FROM products ORDER BY sort_order, id',
    ),
    db.prepare('SELECT id, title, description, visible, price_cents FROM cachaca ORDER BY id'),
  ]
  const decode = (results: D1Result[]): SnapshotResult => {
    if (
      results.length !== 4 ||
      results.some((result) => !result.success) ||
      results[0].results.length !== 1 ||
      results[1].results.length !== 1
    )
      throw new Error('Snapshot indisponível')
    const revision = (results[1].results[0] as { revision: number }).revision
    return {
      authorized: (results[0].results[0] as { authorized: number }).authorized === 1,
      snapshot: {
        revision: revisionToken(revision),
        chopes: (results[2].results as ProductRow[]).map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          visible: row.visible === 1,
          prices: { 30: row.price_30_cents, 50: row.price_50_cents },
        })),
        cachacas: (results[3].results as BottleRow[]).map((row) => ({
          id: row.id,
          name: row.title,
          description: row.description,
          visible: row.visible === 1,
          prices: { bottle: row.price_cents },
        })),
      },
    }
  }
  return {
    async load(): Promise<SnapshotResult> {
      return decode(await db.batch(reads()))
    },
    async save(snapshot: CatalogSnapshot, expectedRevision: number): Promise<CatalogSaveResult> {
      const [accepted, ...state] = await db.batch([
        db
          .prepare(
            `UPDATE catalog_save SET payload = ? WHERE singleton = 1 AND revision = ? AND ${proof.sql} RETURNING 1 AS accepted`,
          )
          .bind(JSON.stringify(snapshot), expectedRevision, ...proof.values),
        ...reads(),
      ])
      if (!accepted.success || accepted.results.length > 1)
        throw new Error('Salvamento indisponível')
      const current = decode(state)
      // RETURNING na view é só um recibo; a revisão é lida depois dos triggers.
      if (
        accepted.results.length === 1 &&
        (accepted.results[0] as { accepted: number }).accepted === 1
      )
        return { status: 'ok', snapshot: current.snapshot }
      return current.authorized ? { status: 'conflict' } : { status: 'unauthorized' }
    },
  }
}
