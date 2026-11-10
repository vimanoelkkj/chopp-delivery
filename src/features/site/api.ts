import { CMS_LIMITS } from '../../../shared/cms/common'
import { deriveLayout } from '../../../shared/cms/layout'
import { exact, materialize } from '../../../shared/cms/primitives'
import { CMS_RULES_V2, type CmsCarouselEntry } from '../../../shared/cms/v2'
import { parseCmsDocument } from '../../../shared/cms/validation-v2'
import type { CatalogState } from '../catalog/useCatalog'

/** Accept only the public projection, never an administrative snapshot or a draft. */
export function parsePublishedSite(input: unknown) {
  const value = materialize(input, CMS_LIMITS.bytes + 1024)?.value
  if (
    !exact(value, ['schemaVersion', 'commercial', 'modules']) ||
    value.schemaVersion !== 2 ||
    !Array.isArray(value.modules)
  )
    throw Error('INVALID_PUBLIC_SITE')
  const modules = value.modules.map((module) => {
    if (
      !exact(module, ['id', 'template', 'navigation', 'content', 'anchor']) ||
      typeof module.template !== 'string' ||
      !Object.hasOwn(CMS_RULES_V2, module.template) ||
      module.anchor !== CMS_RULES_V2[module.template as keyof typeof CMS_RULES_V2].anchor
    )
      throw Error('INVALID_PUBLIC_SITE')
    const { anchor: _anchor, ...editorial } = module
    return { ...editorial, visible: true }
  })
  const parsed = parseCmsDocument(
    { schemaVersion: 2, commercial: value.commercial, modules },
    'publish',
  )
  if (parsed.value?.schemaVersion !== 2) throw Error('INVALID_PUBLIC_SITE')
  const layout = deriveLayout(parsed.value)
  if (layout.diagnostics.some((d) => d.severity === 'error')) throw Error('INVALID_PUBLIC_SITE')
  return { document: parsed.value, layout }
}

export type PublishedSite = ReturnType<typeof parsePublishedSite>

export async function fetchPublishedSite(signal: AbortSignal): Promise<PublishedSite | null> {
  const response = await fetch('/api/site', {
    method: 'GET',
    cache: 'no-store',
    // Preserve the origin's Access policy in private homologation; never forward across redirects.
    credentials: 'same-origin',
    redirect: 'error',
    signal,
  })
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/json')
    throw Error('PUBLIC_SITE_UNAVAILABLE')
  const raw = await response.text()
  if (new TextEncoder().encode(raw).length > CMS_LIMITS.bytes + 1024)
    throw Error('INVALID_PUBLIC_SITE')
  const body: unknown = JSON.parse(raw)
  if (
    response.status === 404 &&
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'code' in body.error &&
    body.error.code === 'CMS_NOT_PUBLISHED'
  )
    return null
  if (!response.ok) throw Error('PUBLIC_SITE_UNAVAILABLE')
  return parsePublishedSite(body)
}

/** Editorial IDs select/order the carousel; the catalog retains every commercial field. */
export function selectEditorialCarousel(
  entries: CmsCarouselEntry[],
  state: CatalogState,
): CatalogState {
  if (state.status !== 'ready') return state
  const category = state.catalog.expanded.categories.find((c) => c.id === 'chopes')
  const available = new Map(
    category?.items.filter((item) => item.visible).map((item) => [item.id, item]) ?? [],
  )
  const selected = entries.flatMap((entry) => {
    const item = available.get(entry.itemId)
    return item ? [item] : []
  })
  // Seleção vazia ou já indisponível nunca esvazia a vitrine: o catálogo válido prevalece.
  if (selected.length === 0) return state
  return {
    ...state,
    catalog: {
      ...state.catalog,
      expanded: {
        ...state.catalog.expanded,
        categories: state.catalog.expanded.categories.map((c) =>
          c.id === 'chopes'
            ? {
                ...c,
                items: selected,
              }
            : c,
        ),
      },
    },
  }
}
