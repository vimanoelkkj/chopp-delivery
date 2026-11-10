import type { AuthConfig } from '../auth/http'
import { type AdminPrincipal, adminWriteProof } from '../auth/session'

/**
 * Imagem principal de um produto comercial (F4A.6.4C). Associação em tabela própria, com revisão
 * própria que cresce também quando só o `alt` muda e que continua crescendo depois de remover a
 * imagem (a linha vira "tombstone"): um token antigo nunca volta a valer. A tabela só existe depois
 * da migration 0013; antes dela, tudo aqui se comporta como "sem imagens".
 */
export const CATALOG_MEDIA_MIGRATION = '0013_catalog_item_media.sql'
const OBJECTS = 8 // 1 tabela + 1 view + 6 gatilhos

export type Association = {
  itemId: string
  mediaId: string | null
  alt: string | null
  revision: number
}
type Authorization = { principal: AdminPrincipal; config: AuthConfig }

export const revisionToken = (revision: number) => `m${revision}`
export function parseRevision(header: string): number | null {
  const match = /^"m(0|[1-9][0-9]{0,15})"$/.exec(header)
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : null
}

const ready = new WeakSet<D1Database>()
/** A migration 0013 e todos os seus objetos existem? Só o resultado positivo é guardado. */
export async function catalogMediaReady(db: D1Database): Promise<boolean> {
  if (ready.has(db)) return true
  try {
    const row = await db
      .prepare(
        `SELECT (SELECT count(*) FROM sqlite_schema WHERE
          (type = 'table' AND name = 'catalog_item_media')
          OR (type = 'view' AND name = 'catalog_media_write')
          OR (type = 'trigger' AND name IN ('catalog_item_media_no_delete',
            'catalog_item_media_revision_guard', 'catalog_item_media_ready_insert',
            'catalog_item_media_ready_update', 'cms_media_catalog_referenced_guard',
            'catalog_media_write_command'))) AS objects,
          EXISTS (SELECT 1 FROM d1_migrations WHERE name = ?) AS applied`,
      )
      .bind(CATALOG_MEDIA_MIGRATION)
      .first<{ objects: number; applied: number }>()
    const ok = row?.objects === OBJECTS && row.applied === 1
    if (ok) ready.add(db)
    return ok
  } catch {
    return false
  }
}

type Row = { item_id: string; media_id: string | null; alt: string | null; revision: number }
const toAssociation = (row: Row): Association => ({
  itemId: row.item_id,
  mediaId: row.media_id,
  alt: row.alt,
  revision: row.revision,
})

export function catalogMediaRepository(db: D1Database, authorization?: Authorization) {
  const proof = authorization
    ? adminWriteProof(authorization.principal, authorization.config)
    : null
  const current = (itemId: string) =>
    db
      .prepare(
        `SELECT i.id AS item_id, m.media_id AS media_id, m.alt AS alt, COALESCE(m.revision, 0) AS revision
         FROM catalog_items i LEFT JOIN catalog_item_media m ON m.item_id = i.id WHERE i.id = ?`,
      )
      .bind(itemId)
  return {
    /** `null` quando o produto não existe (oculto conta como existente). */
    async get(itemId: string): Promise<Association | null> {
      const row = await current(itemId).first<Row>()
      return row ? toAssociation(row) : null
    },
    async list(): Promise<Association[]> {
      const rows = await db
        .prepare('SELECT item_id, media_id, alt, revision FROM catalog_item_media ORDER BY item_id')
        .all<Row>()
      return rows.results.map(toAssociation)
    },
    /** Estado de uma mídia: só `ready` com derivados pode ser associada. */
    async mediaState(mediaId: string): Promise<'ready' | 'not-ready' | 'missing'> {
      const row = await db
        .prepare(
          'SELECT state, derivatives_json IS NOT NULL AS derived FROM cms_media WHERE media_id = ?',
        )
        .bind(mediaId)
        .first<{ state: string; derived: number }>()
      if (!row) return 'missing'
      return row.state === 'ready' && row.derived === 1 ? 'ready' : 'not-ready'
    },
    /** Troca a associação se a revisão ainda for a esperada; `null` remove. */
    async write(
      itemId: string,
      expected: number,
      media: { mediaId: string; alt: string } | null,
    ): Promise<{ status: 'ok' | 'conflict' | 'unauthorized'; association: Association | null }> {
      if (!proof) throw new Error('Authorization required')
      const [receipt, state] = await db.batch([
        db
          .prepare(
            `UPDATE catalog_media_write SET media_id = ?, alt = ?, session_hash = ?, user_id = ?, origin = ?
             WHERE item_id = ? AND revision = ? AND ${proof.sql} RETURNING 1 AS accepted`,
          )
          .bind(
            media?.mediaId ?? null,
            media?.alt ?? null,
            ...proof.values,
            itemId,
            expected,
            ...proof.values,
          ),
        db
          .prepare(
            `SELECT ${proof.sql} AS authorized, i.id AS item_id, m.media_id AS media_id, m.alt AS alt,
               COALESCE(m.revision, 0) AS revision
             FROM catalog_items i LEFT JOIN catalog_item_media m ON m.item_id = i.id WHERE i.id = ?`,
          )
          .bind(...proof.values, itemId),
      ])
      if (!receipt.success || receipt.results.length > 1)
        throw new Error('CATALOG_MEDIA_UNAVAILABLE')
      const row = (state.results as (Row & { authorized: number })[])[0]
      const association = row ? toAssociation(row) : null
      if (receipt.results.length === 1) return { status: 'ok', association }
      return { status: row?.authorized === 1 ? 'conflict' : 'unauthorized', association }
    },
  }
}

/**
 * Imagens públicas por produto: só mídia `ready`. A visibilidade do produto é filtrada por quem
 * monta o catálogo público. Qualquer falha (inclusive migration ausente) devolve vazio: a imagem é um
 * acessório e nunca pode derrubar o catálogo.
 */
export async function publicItemImages(
  db: D1Database,
): Promise<Map<string, { id: string; alt: string }>> {
  const images = new Map<string, { id: string; alt: string }>()
  if (!(await catalogMediaReady(db))) return images
  try {
    const rows = await db
      .prepare(
        `SELECT c.item_id AS item_id, c.media_id AS media_id, c.alt AS alt
         FROM catalog_item_media c JOIN cms_media m ON m.media_id = c.media_id
         WHERE c.media_id IS NOT NULL AND m.state = 'ready' AND m.derivatives_json IS NOT NULL`,
      )
      .all<{ item_id: string; media_id: string; alt: string }>()
    for (const row of rows.results) images.set(row.item_id, { id: row.media_id, alt: row.alt })
  } catch {
    images.clear()
  }
  return images
}
