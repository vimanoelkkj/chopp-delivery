import { CMS_ITEM_ID_PATTERN, CMS_LIMITS } from '../../../../shared/cms'
import type { CmsDocumentV2 } from '../../../../shared/cms/v2'
import type { AdminCatalog } from '../catalog/types'

/** Only persisted, visible chopes. Commercial data never enters the editorial document. */
export function eligibleBarrels(catalog: AdminCatalog) {
  return catalog.categories
    .filter((category) => category.id === 'chopes')
    .flatMap((category) => category.items)
    .filter((item) => item.visible && CMS_ITEM_ID_PATTERN.test(item.id))
    .map(({ id, name }) => ({ id, name }))
}

export function changeCarousel(
  doc: CmsDocumentV2,
  moduleId: string,
  action:
    | { kind: 'add'; itemId: string; catalog: AdminCatalog }
    | { kind: 'remove'; itemId: string }
    | { kind: 'move'; itemId: string; direction: -1 | 1 },
): CmsDocumentV2 {
  const module = doc.modules.find((entry) => entry.id === moduleId)
  if (module?.template !== 'carousel') return doc
  const entries = [...module.content.entries]
  const index = entries.findIndex((entry) => entry.itemId === action.itemId)
  if (action.kind === 'add') {
    if (
      index !== -1 ||
      entries.length >= CMS_LIMITS.list ||
      !eligibleBarrels(action.catalog).some((item) => item.id === action.itemId)
    )
      return doc
    entries.push({ itemId: action.itemId, media: null })
  } else {
    if (index === -1) return doc
    if (action.kind === 'remove') entries.splice(index, 1)
    else {
      const target = index + action.direction
      if (target < 0 || target >= entries.length) return doc
      ;[entries[index], entries[target]] = [entries[target], entries[index]]
    }
  }
  return {
    ...doc,
    modules: doc.modules.map((entry) =>
      entry === module ? { ...module, content: { ...module.content, entries } } : entry,
    ),
  }
}
