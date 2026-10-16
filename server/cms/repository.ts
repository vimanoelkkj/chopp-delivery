import type { CmsAdminSnapshot, CmsCommandResult, CmsMutation } from '../../shared/cms'
import type { AuthConfig } from '../auth/http'
import { type AdminPrincipal, adminWriteProof } from '../auth/session'
import { cmsRevision, cmsUuid, validateCmsDocument, validateCmsMutation } from './validation'

type Authorization = { principal: AdminPrincipal; config: AuthConfig }
type Row = Record<string, unknown>
// Stable key order for semantically identical JSON; array order remains significant.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
function document(json: unknown) {
  if (typeof json !== 'string') throw new Error('CMS_STATE_INVALID')
  const parsed = validateCmsDocument(JSON.parse(json), 'draft')
  if (!parsed.value) throw new Error('CMS_STATE_INVALID')
  return parsed.value
}
export function cmsRepository(db: D1Database, authorization: Authorization) {
  const proof = adminWriteProof(authorization.principal, authorization.config)
  const authorized = () =>
    db
      .prepare(`SELECT ${proof.sql} AS authorized, EXISTS(SELECT 1 FROM cms_ready) AS ready`)
      .bind(...proof.values)
  const assertAccess = (row: Row | undefined) => {
    if (row?.authorized !== 1) throw new Error('CMS_UNAUTHORIZED')
    if (row.ready !== 1) throw new Error('CMS_SCHEMA_UNAVAILABLE')
  }
  const receipt = (row: Row): CmsCommandResult => {
    if (
      !cmsUuid(row.operation_id) ||
      !cmsRevision(row.expected_revision) ||
      !cmsRevision(row.resulting_revision) ||
      typeof row.version_id !== 'string' ||
      !row.version_id.startsWith('version_') ||
      !cmsUuid(row.version_id.slice(8)) ||
      row.kind !== 'draft'
    )
      throw new Error('CMS_STATE_INVALID')
    return {
      command: {
        operationId: row.operation_id,
        action: 'saveDraft',
        expectedRevision: row.expected_revision,
        revision: row.resulting_revision,
        versionId: row.version_id,
      },
      site: {
        draft: { revision: row.resulting_revision, document: document(row.document_json) },
        published: null,
      },
    }
  }
  const commandQuery = (id: string) =>
    db
      .prepare('SELECT * FROM cms_versions WHERE operation_id = ? AND actor_id = ?')
      .bind(id, authorization.principal.user.id)
  return {
    async load(): Promise<CmsAdminSnapshot> {
      const [access, state] = await db.batch<Row>([
        authorized(),
        db.prepare(
          `SELECT s.*,v.document_json,v.resulting_revision FROM cms_state s LEFT JOIN cms_versions v ON v.version_id = s.draft_version_id WHERE s.singleton = 1`,
        ),
      ])
      assertAccess(access.results[0])
      if (state.results.length !== 1) throw new Error('CMS_STATE_INVALID')
      const row = state.results[0]
      if (
        !cmsRevision(row.draft_revision) ||
        row.published_version_id !== null ||
        row.published_revision !== null ||
        (row.draft_version_id !== null && row.resulting_revision !== row.draft_revision)
      )
        throw new Error('CMS_STATE_INVALID')
      return {
        draft: {
          revision: row.draft_revision,
          document: row.draft_version_id === null ? null : document(row.document_json),
        },
        published: null,
      }
    },
    async command(id: string): Promise<CmsCommandResult | null> {
      const [access, result] = await db.batch<Row>([authorized(), commandQuery(id)])
      assertAccess(access.results[0])
      return result.results.length === 1 ? receipt(result.results[0]) : null
    },
    async save(input: CmsMutation): Promise<CmsCommandResult> {
      const parsed = validateCmsMutation(input)
      if (parsed.value?.action !== 'saveDraft') throw new Error('CMS_INVALID_COMMAND')
      const command = parsed.value
      const documentJson = canonical(command.document)
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(command))),
        ),
      ]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const version = `version_${crypto.randomUUID()}`,
        revision = `c1_${crypto.randomUUID()}`
      const [write, access, result] = await db.batch<Row>([
        db
          .prepare(
            `UPDATE cms_draft_write SET version_id=?, operation_id=?, expected_revision=?, resulting_revision=?, document_json=?, command_hash=?, actor_id=?, session_hash=?, origin=? WHERE singleton=1 AND ${proof.sql}`,
          )
          .bind(
            version,
            command.operationId,
            command.expectedRevision,
            revision,
            documentJson,
            hash,
            authorization.principal.user.id,
            authorization.principal.sessionHash,
            authorization.config.origin,
            ...proof.values,
          ),
        authorized(),
        commandQuery(command.operationId),
      ])
      if (!write.success) throw new Error('CMS_UNAVAILABLE')
      assertAccess(access.results[0])
      if (result.results.length !== 1 || result.results[0].command_hash !== hash)
        throw new Error('CMS_WRITE_INCOMPLETE')
      return receipt(result.results[0])
    },
  }
}
