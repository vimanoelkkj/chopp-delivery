import { deriveLayout } from '../../../../shared/cms/layout'
import { cmsRevision, exact } from '../../../../shared/cms/primitives'
import type { CmsCarouselEntry, CmsDocumentV2 } from '../../../../shared/cms/v2'
import { parseCmsDocument } from '../../../../shared/cms/validation-v2'
import type { CatalogState } from '../../catalog/useCatalog'

export type PreviewDocument = {
  document: CmsDocumentV2
  revision: string
  layout: ReturnType<typeof deriveLayout>
}
export function readPreviewSnapshot(value: unknown): PreviewDocument | null {
  const keys =
    typeof value === 'object' && value !== null && Object.hasOwn(value, 'warnings')
      ? ['schema', 'draft', 'published', 'warnings']
      : ['schema', 'draft', 'published']
  if (
    !exact(value, keys) ||
    !exact(value.draft, ['revision', 'document']) ||
    !cmsRevision(value.draft.revision) ||
    value.published !== null ||
    ('warnings' in value &&
      (!Array.isArray(value.warnings) || !value.warnings.every((w) => typeof w === 'string')))
  )
    throw new Error('INVALID_PREVIEW')
  if (value.schema === null && value.draft.document === null) return null
  if (
    value.schema === 1 &&
    typeof value.draft.document === 'object' &&
    value.draft.document !== null &&
    'schemaVersion' in value.draft.document &&
    value.draft.document.schemaVersion === 1
  )
    return null
  if (value.schema !== 2 || !value.draft.revision.startsWith('c2_'))
    throw new Error('INVALID_PREVIEW')
  const parsed = parseCmsDocument(value.draft.document)
  if (parsed.value?.schemaVersion !== 2) throw new Error('INVALID_PREVIEW')
  const layout = deriveLayout(parsed.value)
  if (layout.diagnostics.some((d) => d.severity === 'error')) throw new Error('INVALID_PREVIEW')
  return { document: parsed.value, revision: value.draft.revision, layout }
}

export function previewCarousel(
  entries: CmsCarouselEntry[],
  state: CatalogState,
): { state: CatalogState; unavailable: string[] } {
  if (state.status !== 'ready') return { state, unavailable: [] }
  const category = state.catalog.expanded.categories.find((c) => c.id === 'chopes')
  const available = new Map(category?.items.filter((i) => i.visible).map((i) => [i.id, i]) ?? [])
  const unavailable = entries.filter((e) => !available.has(e.itemId)).map((e) => e.itemId)
  return {
    state: {
      ...state,
      catalog: {
        ...state.catalog,
        expanded: {
          ...state.catalog.expanded,
          categories: category
            ? [
                {
                  ...category,
                  items: entries.flatMap((e) => {
                    const item = available.get(e.itemId)
                    return item ? [item] : []
                  }),
                },
              ]
            : [],
        },
      },
    },
    unavailable,
  }
}
