import type {
  CmsAdminSnapshot,
  CmsCommandResult,
  CmsConversionRequest,
  CmsDocumentV2,
  CmsMutation,
  CmsMutationV2,
  CmsVersionedAdminSnapshot,
  CmsVersionedCommandResult,
} from '../../shared/cms'
import type { AuthConfig } from '../auth/http'
import { type AdminPrincipal, adminWriteProof } from '../auth/session'
import { canonical, commandHash } from './canonical'
import { parseCmsConversion } from './commands'
import { convertCmsV1ToV2 } from './convert'
import { type CmsMediaRecord, publicationMediaErrors } from './media-contract'
import { collectMediaRefs } from './media-refs'
import { cmsRevision, cmsUuid } from './primitives'
import { cmsV1Repository } from './repository-v1'
import {
  parseCmsDocument,
  parseCmsMutation,
  projectPublicCmsV2,
  readCmsPublished,
} from './validation-v2'

type Authorization = { principal: AdminPrincipal; config: AuthConfig }
type Row = {
  version_id: string
  operation_id: string
  expected_revision: string
  resulting_revision: string
  document_json: string
  command_hash: string
  actor_id: string
  kind: string
  origin_kind?: 'save' | 'convert' | 'start'
  source_version_id: string | null
  published_version_id?: string | null
}
type Head =
  | {
      schema: 2
      revision: string
      versionId: string
      document: CmsDocumentV2
      published: ReturnType<typeof readCmsPublished>
    }
  | {
      schema: 1 | null
      revision: string
      versionId: string | null
      document: CmsAdminSnapshot['draft']['document']
    }
export function cmsRepository(db: D1Database, authorization: Authorization) {
  const legacy = cmsV1Repository(db, authorization),
    proof = adminWriteProof(authorization.principal, authorization.config)
  const authorized = () =>
    db
      .prepare(`SELECT ${proof.sql} AS authorized,EXISTS(SELECT 1 FROM cms_ready) AS ready`)
      .bind(...proof.values)
  const assertAccess = (r: unknown) => {
    if (typeof r !== 'object' || r === null || !('authorized' in r) || r.authorized !== 1)
      throw Error('CMS_UNAUTHORIZED')
    if (!('ready' in r) || r.ready !== 1) throw Error('CMS_SCHEMA_UNAVAILABLE')
  }
  const access = async () => assertAccess(await authorized().first())
  const available = async () => {
    if (
      !(await db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='view' AND name='cms_ready_v2'")
        .first())
    )
      return false
    return Boolean(await db.prepare('SELECT 1 FROM cms_ready_v2').first())
  }
  const requireV2 = async () => {
    await access()
    if (!(await available())) throw Error('CMS_SCHEMA_UNAVAILABLE')
  }
  const document2 = (json: string, mode: 'draft' | 'publish' = 'draft') => {
    const r = parseCmsDocument(JSON.parse(json), mode)
    if (r.value?.schemaVersion !== 2) throw Error('CMS_STATE_INVALID')
    return r.value
  }
  const validateRow = (r: Row) => {
    if (
      !cmsUuid(r.operation_id) ||
      !cmsUuid(r.version_id?.slice(8)) ||
      !r.version_id.startsWith('version_') ||
      !cmsRevision(r.expected_revision) ||
      !cmsRevision(r.resulting_revision) ||
      !r.resulting_revision.startsWith('c2_') ||
      !['draft', 'published'].includes(r.kind) ||
      (r.kind === 'published' &&
        (r.origin_kind !== 'save' || r.published_version_id !== r.version_id)) ||
      !['save', 'convert', 'start'].includes(r.origin_kind ?? '')
    )
      throw Error('CMS_STATE_INVALID')
  }
  const published = async (id: string | null | undefined, revision?: string) => {
    if (!id) return null
    const r = await db
      .prepare('SELECT * FROM cms_v2_versions WHERE version_id=?')
      .bind(id)
      .first<Row>()
    if (r?.kind !== 'published' || (revision !== undefined && r.resulting_revision !== revision))
      throw Error('CMS_STATE_INVALID')
    validateRow(r)
    return readCmsPublished({
      versionId: r.version_id,
      revision: r.resulting_revision,
      document: document2(r.document_json, 'publish'),
    })
  }
  const receipt = (r: Row): CmsVersionedCommandResult => {
    validateRow(r)
    return {
      command: {
        operationId: r.operation_id,
        action:
          r.kind === 'published'
            ? 'publish'
            : r.origin_kind === 'convert'
              ? 'convertToV2'
              : r.origin_kind === 'start'
                ? 'startV2'
                : 'saveDraft',
        expectedRevision: r.expected_revision,
        revision: r.resulting_revision,
        versionId: r.version_id,
      },
      site: {
        schema: 2,
        draft: { revision: r.resulting_revision, document: document2(r.document_json) },
        published: null,
      },
    }
  }
  const lookup = async (id: string) => {
    await access()
    const old = await db
      .prepare('SELECT * FROM cms_versions WHERE operation_id=?')
      .bind(id)
      .first<Row>()
    if (old) return { schema: 1 as const, row: old }
    if (await available()) {
      const row = await db
        .prepare('SELECT * FROM cms_v2_versions WHERE operation_id=?')
        .bind(id)
        .first<Row>()
      if (row) return { schema: 2 as const, row }
    }
    return null
  }
  const head = async (): Promise<Head> => {
    await access()
    if (await available()) {
      const [auth, result] = await db.batch([
        authorized(),
        db.prepare(
          'SELECT v.*,s.draft_revision,s.published_version_id,s.published_revision FROM cms_v2_state s LEFT JOIN cms_v2_versions v ON v.version_id=s.draft_version_id WHERE s.singleton=1',
        ),
      ])
      assertAccess(auth.results[0])
      if (result.results.length) {
        if (result.results.length !== 1) throw Error('CMS_STATE_INVALID')
        const row = result.results[0] as unknown as Row & {
          draft_revision: string
          published_version_id: unknown
          published_revision: unknown
        }
        validateRow(row)
        if (
          row.draft_revision !== row.resulting_revision ||
          (row.published_version_id === null) !== (row.published_revision === null)
        )
          throw Error('CMS_STATE_INVALID')
        return {
          schema: 2,
          revision: row.resulting_revision,
          versionId: row.version_id,
          document: document2(row.document_json),
          published: await published(
            row.published_version_id as string | null,
            row.published_revision as string | undefined,
          ),
        }
      }
    }
    const old = await legacy.load()
    const row = old.draft.document
      ? await db
          .prepare('SELECT version_id FROM cms_versions WHERE resulting_revision=?')
          .bind(old.draft.revision)
          .first<{ version_id: string }>()
      : null
    if (old.draft.document && !row) throw Error('CMS_STATE_INVALID')
    return {
      schema: old.draft.document ? 1 : null,
      revision: old.draft.revision,
      versionId: row?.version_id ?? null,
      document: old.draft.document,
    }
  }
  const warnings = async (doc: CmsDocumentV2) => {
    const result = new Set<string>(),
      items = doc.modules.flatMap((m) =>
        m.template === 'carousel' ? m.content.entries.map((e) => e.itemId) : [],
      ),
      ids = collectMediaRefs(doc)
    if (!doc.modules.some((m) => m.template === 'carousel'))
      result.add('COMPOSITION_WITHOUT_CAROUSEL')
    if (items.length) {
      const found = (
        await db
          .prepare(
            `SELECT id,visible FROM catalog_items WHERE category_id='chopes' AND id IN (${items.map(() => '?').join(',')})`,
          )
          .bind(...items)
          .all<{ id: string; visible: number }>()
      ).results
      for (const id of items) {
        const item = found.find((i) => i.id === id)
        if (!item) result.add('ITEM_MISSING')
        else if (item.visible !== 1) result.add('ITEM_HIDDEN')
      }
    }
    if (ids.length) {
      const found = (
        await db
          .prepare(
            `SELECT media_id,state FROM cms_media WHERE media_id IN (${ids.map(() => '?').join(',')})`,
          )
          .bind(...ids)
          .all<{ media_id: string; state: string }>()
      ).results
      if (ids.some((id) => found.find((m) => m.media_id === id)?.state !== 'ready'))
        result.add('MEDIA_NOT_READY')
    }
    await access()
    return [...result].sort()
  }
  const normalized = (c: CmsConversionRequest) => ({
    action: c.action,
    schemaVersion: 2,
    expectedRevision: c.expectedRevision,
    operationId: c.operationId,
    acknowledge: [...(c.acknowledge ?? [])].sort(),
    ...(c.action === 'startV2' ? { document: c.document } : {}),
  })
  const v2Command = async (row: Row) => {
    const result = receipt(row)
    if (result.site.schema === 2) result.site.published = await published(row.published_version_id)
    if (row.origin_kind === 'convert') {
      const source = await db
        .prepare('SELECT document_json FROM cms_versions WHERE version_id=?')
        .bind(row.source_version_id)
        .first<{ document_json: string }>()
      if (!source) throw Error('CMS_WRITE_INCOMPLETE')
      const parsed = parseCmsDocument(JSON.parse(source.document_json))
      if (
        parsed.value?.schemaVersion !== 1 ||
        canonical(convertCmsV1ToV2(parsed.value).document) !== canonical(result.site.draft.document)
      )
        throw Error('CMS_WRITE_INCOMPLETE')
    }
    await access()
    return result
  }
  const replay = async (operation: string, hash: string, origin: 'save' | 'convert' | 'start') => {
    const found = await lookup(operation)
    if (!found) return null
    if (
      found.schema !== 2 ||
      found.row.actor_id !== authorization.principal.user.id ||
      found.row.command_hash !== hash ||
      found.row.origin_kind !== origin
    )
      throw Error('CMS_OPERATION_CONFLICT')
    return v2Command(found.row)
  }
  const execute = async (
    doc: CmsDocumentV2,
    expected: string,
    operation: string,
    hash: string,
    origin: 'save' | 'convert' | 'start',
    source: string | null,
    kind: 'draft' | 'published' = 'draft',
  ) => {
    const version = `version_${crypto.randomUUID()}`,
      revision = `c2_${crypto.randomUUID()}`,
      documentJson = canonical(doc)
    const [write, auth, result] = await db.batch([
      db
        .prepare(
          `UPDATE cms_v2_write SET version_id=?,operation_id=?,expected_revision=?,resulting_revision=?,document_json=?,command_hash=?,actor_id=?,session_hash=?,origin=?,origin_kind=?,source_version_id=?${kind === 'published' ? ",kind='published'" : ''} WHERE singleton=1 AND ${proof.sql}`,
        )
        .bind(
          version,
          operation,
          expected,
          revision,
          documentJson,
          hash,
          authorization.principal.user.id,
          authorization.principal.sessionHash,
          authorization.config.origin,
          origin,
          source,
          ...proof.values,
        ),
      authorized(),
      db
        .prepare('SELECT * FROM cms_v2_versions WHERE operation_id=? AND actor_id=?')
        .bind(operation, authorization.principal.user.id),
    ])
    assertAccess(auth.results[0])
    if (!write.success || result.results.length !== 1) throw Error('CMS_WRITE_INCOMPLETE')
    const row = result.results[0] as unknown as Row
    if (
      row.command_hash !== hash ||
      row.document_json !== documentJson ||
      row.expected_revision !== expected ||
      row.origin_kind !== origin ||
      row.source_version_id !== source ||
      row.kind !== kind
    )
      throw Error('CMS_WRITE_INCOMPLETE')
    return v2Command(row)
  }
  const saveV2 = async (input: unknown): Promise<CmsVersionedCommandResult> => {
    const parsed = parseCmsMutation(input)
    if (parsed.value?.action !== 'saveDraft' || parsed.value.document.schemaVersion !== 2)
      throw Error('CMS_INVALID_COMMAND')
    const c = parsed.value as CmsMutationV2
    await requireV2()
    const hash = await commandHash({
        action: c.action,
        schemaVersion: 2,
        expectedRevision: c.expectedRevision,
        operationId: c.operationId,
        document: c.document,
      }),
      prior = await replay(c.operationId, hash, 'save')
    if (prior) return prior
    const active = await head()
    if (active.schema !== 2 || active.revision !== c.expectedRevision) {
      // Another request may have committed this operation after the first lookup.
      const raced = await replay(c.operationId, hash, 'save')
      if (raced) return raced
      throw Error(active.schema !== 2 ? 'CMS_SCHEMA_MISMATCH' : 'CMS_REVISION_CONFLICT')
    }
    return execute(c.document, c.expectedRevision, c.operationId, hash, 'save', null)
  }
  const publish = async (input: unknown): Promise<CmsVersionedCommandResult> => {
    const parsed = parseCmsMutation(input)
    if (parsed.value?.action !== 'publish' || parsed.value.document.schemaVersion !== 2)
      throw Error('CMS_INVALID_COMMAND')
    const c = parsed.value as CmsMutationV2
    await requireV2()
    await requirePublicationSchema(db)
    const hash = await commandHash(c)
    const replayPublication = async () => {
      const prior = await lookup(c.operationId)
      if (!prior) return null
      if (
        prior.schema !== 2 ||
        prior.row.kind !== 'published' ||
        prior.row.actor_id !== authorization.principal.user.id ||
        prior.row.command_hash !== hash
      )
        throw Error('CMS_OPERATION_CONFLICT')
      return v2Command(prior.row)
    }
    const prior = await replayPublication()
    if (prior) return prior
    const active = await head()
    if (active.schema !== 2 || active.revision !== c.expectedRevision) {
      const raced = await replayPublication()
      if (raced) return raced
      throw Error('CMS_REVISION_CONFLICT')
    }
    if (canonical(active.document) !== canonical(c.document)) throw Error('CMS_DRAFT_MISMATCH')
    const ids = collectMediaRefs(c.document)
    const inventory = new Map<string, CmsMediaRecord>()
    if (ids.length) {
      const rows = await db
        .prepare(
          `SELECT media_id,state,derivatives_json FROM cms_media WHERE media_id IN (${ids.map(() => '?').join(',')})`,
        )
        .bind(...ids)
        .all<{
          media_id: string
          state: CmsMediaRecord['state']
          derivatives_json: string | null
        }>()
      for (const r of rows.results)
        inventory.set(r.media_id, {
          id: r.media_id,
          state: r.state,
          derivatives: JSON.parse(r.derivatives_json ?? 'null'),
        })
    }
    if (publicationMediaErrors(c.document, inventory).length) throw Error('CMS_MEDIA_UNAVAILABLE')
    return execute(c.document, c.expectedRevision, c.operationId, hash, 'save', null, 'published')
  }
  type PreviewResult = {
    preview: { from: { versionId: string; revision: string } } & ReturnType<typeof convertCmsV1ToV2>
  }
  async function conversion(input: unknown, action: 'previewConversion'): Promise<PreviewResult>
  async function conversion(
    input: unknown,
    action: 'convertToV2' | 'startV2',
  ): Promise<CmsVersionedCommandResult>
  async function conversion(
    input: unknown,
    action: 'previewConversion' | 'convertToV2' | 'startV2',
  ): Promise<PreviewResult | CmsVersionedCommandResult> {
    const parsed = parseCmsConversion(input)
    if (!parsed.value || parsed.value.action !== action) throw Error('CMS_INVALID_COMMAND')
    const c = parsed.value
    await requireV2()
    const hash = await commandHash(normalized(c))
    if (action !== 'previewConversion') {
      const prior = await replay(c.operationId, hash, action === 'startV2' ? 'start' : 'convert')
      if (prior) return prior
    }
    const active = await head()
    if (active.schema === 2 || active.revision !== c.expectedRevision) {
      if (action !== 'previewConversion') {
        const raced = await replay(c.operationId, hash, action === 'startV2' ? 'start' : 'convert')
        if (raced) return raced
      }
      throw Error(active.schema === 2 ? 'CMS_ALREADY_V2' : 'CMS_REVISION_CONFLICT')
    }
    if (c.action === 'startV2') {
      if (active.document) throw Error('CMS_SCHEMA_MISMATCH')
      return execute(c.document, c.expectedRevision, c.operationId, hash, 'start', null)
    }
    if (!active.document || !active.versionId) throw Error('CMS_SCHEMA_MISMATCH')
    const converted = convertCmsV1ToV2(active.document)
    if (action === 'previewConversion') {
      await access()
      return {
        preview: { from: { versionId: active.versionId, revision: active.revision }, ...converted },
      }
    }
    if (converted.losses.some((loss) => !c.acknowledge?.includes(loss)))
      throw Error('CMS_ACKNOWLEDGEMENT_REQUIRED')
    return execute(
      converted.document,
      c.expectedRevision,
      c.operationId,
      hash,
      'convert',
      active.versionId,
    )
  }
  async function save(input: CmsMutation): Promise<CmsCommandResult>
  async function save(input: CmsMutationV2): Promise<CmsVersionedCommandResult>
  async function save(
    input: CmsMutation | CmsMutationV2,
  ): Promise<CmsCommandResult | CmsVersionedCommandResult>
  async function save(
    input: CmsMutation | CmsMutationV2,
  ): Promise<CmsCommandResult | CmsVersionedCommandResult> {
    const parsed = parseCmsMutation(input)
    if (parsed.value?.action !== 'saveDraft') throw Error('CMS_INVALID_COMMAND')
    if (parsed.value.document.schemaVersion === 2) return saveV2(parsed.value)
    const c = parsed.value as CmsMutation,
      old = await lookup(c.operationId)
    if (old) {
      if (
        old.schema !== 1 ||
        old.row.actor_id !== authorization.principal.user.id ||
        old.row.command_hash !== (await commandHash(c))
      )
        throw Error('CMS_OPERATION_CONFLICT')
      const r = await legacy.command(c.operationId)
      if (!r) throw Error('CMS_WRITE_INCOMPLETE')
      return r
    }
    const active = await head()
    if (active.schema === 2) throw Error('CMS_SCHEMA_SUPERSEDED')
    if (!c.expectedRevision.startsWith('c1_')) throw Error('CMS_REVISION_CONFLICT')
    return legacy.save(c)
  }
  return {
    async load(): Promise<CmsVersionedAdminSnapshot> {
      const active = await head()
      if (active.schema === 2)
        return {
          schema: 2,
          draft: { revision: active.revision, document: active.document },
          published: active.published,
          warnings: await warnings(active.document),
        }
      return active.document
        ? {
            schema: 1,
            draft: { revision: active.revision, document: active.document },
            published: null,
            warnings: [],
          }
        : {
            schema: null,
            draft: { revision: active.revision, document: null },
            published: null,
            warnings: [],
          }
    },
    async command(id: string) {
      const found = await lookup(id)
      if (!found || found.row.actor_id !== authorization.principal.user.id) {
        await access()
        return null
      }
      return found.schema === 1 ? legacy.command(id) : v2Command(found.row)
    },
    save,
    saveV2,
    publish,
    previewConversion: (input: CmsConversionRequest) => conversion(input, 'previewConversion'),
    convertToV2: (input: CmsConversionRequest) => conversion(input, 'convertToV2'),
    startV2: (input: CmsConversionRequest) => conversion(input, 'startV2'),
  }
}

export async function requirePublicationSchema(db: D1Database) {
  if (
    !(await db
      .prepare("SELECT 1 FROM sqlite_schema WHERE type='view' AND name='cms_ready_publication'")
      .first()) ||
    !(await db.prepare('SELECT 1 FROM cms_ready_publication').first())
  )
    throw Error('CMS_SCHEMA_UNAVAILABLE')
}

/** Public reads follow only the published pointer; never return a draft or internal metadata. */
export async function loadPublishedCms(db: D1Database) {
  await requirePublicationSchema(db)
  const row = await db
    .prepare(`SELECT s.published_version_id,s.published_revision,v.kind,v.resulting_revision,v.document_json
    FROM cms_v2_state s LEFT JOIN cms_v2_versions v ON v.version_id=s.published_version_id WHERE s.singleton=1`)
    .first<{
      published_version_id: string | null
      published_revision: string | null
      kind: string | null
      resulting_revision: string | null
      document_json: string | null
    }>()
  if (!row || (row.published_version_id === null && row.published_revision === null)) return null
  if (
    row.kind !== 'published' ||
    row.resulting_revision !== row.published_revision ||
    !row.document_json
  )
    throw Error('CMS_STATE_INVALID')
  return {
    revision: row.published_revision,
    document: projectPublicCmsV2(JSON.parse(row.document_json)),
  }
}
